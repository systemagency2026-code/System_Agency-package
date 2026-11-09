export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  ALLOWED_ORIGIN?: string;
  APP_URL?: string;
}
export interface Deps {
  env: Env;
  clienteUsuario: (authorization: string) => any; // cliente con la identidad de quien llama
  clienteServicio: any; // cliente con service_role (solo servidor)
  fetch: typeof fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO = /^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/;

export function escapeHtml(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cabeceras(env: Env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function responder(env: Env, status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...cabeceras(env), "Content-Type": "application/json" },
  });
}

/** Devuelve el administrador que llama, o el motivo del rechazo. */
async function exigirAdmin(req: Request, d: Deps) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer "))
    return { ok: false, status: 401, mensaje: "Debes iniciar sesión." };

  const { data, error } = await d.clienteUsuario(auth).auth.getUser();
  const usuario = data?.user;
  if (error || !usuario)
    return {
      ok: false,
      status: 401,
      mensaje: "Tu sesión no es válida. Vuelve a iniciar sesión.",
    };

  const { data: perfil } = await d.clienteServicio
    .from("perfiles")
    .select("rol, activo")
    .eq("id", usuario.id)
    .maybeSingle();
  if (!perfil || perfil.rol !== "admin" || !perfil.activo) {
    return {
      ok: false,
      status: 403,
      mensaje: "No tienes permiso para esta operación.",
    };
  }
  return { ok: true, id: usuario.id as string, auth };
}

async function enviarCorreo(
  d: Deps,
  para: string,
  asunto: string,
  html: string,
) {
  const { RESEND_API_KEY, EMAIL_FROM } = d.env;
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    return {
      enviado: false,
      aviso:
        "El servicio de correo no está configurado (faltan RESEND_API_KEY o EMAIL_FROM).",
    };
  }
  try {
    const r = await d.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [para],
        subject: asunto.replace(/[\r\n]+/g, " "),
        html,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) return { enviado: true };
    const cuerpo = await r.json().catch(() => ({}));
    return {
      enviado: false,
      aviso: String(
        cuerpo?.message ??
          `El servicio de correo respondió con el código ${r.status}.`,
      ).slice(0, 200),
    };
  } catch {
    return {
      enviado: false,
      aviso: "No se pudo contactar al servicio de correo.",
    };
  }
}

const cajaCorreo = (contenido: string) =>
  `<div style="font-family:Arial,sans-serif;color:#333;max-width:560px">${contenido}</div>`;

async function aprobar(body: any, admin: any, d: Deps) {
  const solicitudId = String(body.solicitud_id ?? "");
  const codigo = String(body.codigo ?? "").trim();
  const nombre = String(body.nombre_agencia ?? "").trim();
  const password = String(body.password ?? "");
  const logo = body.logo_url ? String(body.logo_url) : null;

  if (!UUID.test(solicitudId))
    return responder(d.env, 400, { error: "Solicitud no válida." });
  if (!CODIGO.test(codigo))
    return responder(d.env, 400, {
      error: "El código debe tener de 2 a 20 letras, números o guiones.",
    });
  if (nombre.length < 2 || nombre.length > 120)
    return responder(d.env, 400, {
      error: "El nombre de la agencia debe tener entre 2 y 120 caracteres.",
    });
  if (password.length < 8 || new TextEncoder().encode(password).length > 72) {
    return responder(d.env, 400, {
      error:
        "La contraseña debe tener al menos 8 caracteres (máximo 72 bytes).",
    });
  }
  if (
    logo &&
    (logo.length > 500 ||
      !logo.startsWith(`${d.env.SUPABASE_URL}/storage/v1/object/public/`))
  ) {
    return responder(d.env, 400, {
      error: "El logo debe ser un archivo del almacenamiento del proyecto.",
    });
  }

  const svc = d.clienteServicio;
  const { data: sol } = await svc
    .from("solicitudes_afiliacion")
    .select("id, estado, correo, nombre_contacto, nombre_negocio")
    .eq("id", solicitudId)
    .maybeSingle();
  if (!sol) return responder(d.env, 404, { error: "La solicitud no existe." });
  if (sol.estado !== "pendiente")
    return responder(d.env, 409, { error: "La solicitud ya fue resuelta." });

  // 1) Usuario de acceso en Supabase Auth
  const { data: creado, error: errUsuario } = await svc.auth.admin.createUser({
    email: sol.correo,
    password,
    email_confirm: true,
  });
  if (errUsuario || !creado?.user) {
    console.error("createUser falló:", errUsuario?.code, errUsuario?.status);
    if (errUsuario?.code === "email_exists" || errUsuario?.status === 422) {
      return responder(d.env, 409, {
        error: "Ya existe un usuario con ese correo.",
      });
    }
    return responder(d.env, 500, {
      error: "No se pudo crear el usuario de acceso.",
    });
  }

  // 2) Agencia + perfil + solicitud aprobada, en una sola transacción
  const { data: agenciaId, error: errRpc } = await svc.rpc(
    "crear_agencia_desde_solicitud",
    {
      p_admin_id: admin.id,
      p_solicitud_id: sol.id,
      p_codigo: codigo,
      p_nombre: nombre,
      p_usuario_id: creado.user.id,
      p_logo_url: logo,
    },
  );
  if (errRpc) {
    // Deshacer: no debe quedar un usuario huérfano sin agencia
    try {
      await svc.auth.admin.deleteUser(creado.user.id);
    } catch (e) {
      console.error("deleteUser falló:", e);
    }
    console.error("crear_agencia_desde_solicitud falló:", errRpc.code);
    if (errRpc.code === "23505")
      return responder(d.env, 409, {
        error: "Ese código de agencia ya está en uso.",
      });
    if (errRpc.code === "23514")
      return responder(d.env, 400, {
        error: "Revisa los datos: alguno no tiene un formato válido.",
      });
    if (errRpc.code === "42501")
      return responder(d.env, 403, {
        error: "No tienes permiso para esta operación.",
      });
    if (errRpc.code === "P0001")
      return responder(d.env, 409, { error: errRpc.message });
    return responder(d.env, 500, { error: "No se pudo crear la agencia." });
  }

  // 3) Correo con las credenciales (si falla, la agencia ya existe: se avisa al administrador)
  const e = escapeHtml;
  const enlace = d.env.APP_URL?.startsWith("https://")
    ? `<p><a href="${e(d.env.APP_URL)}">Ingresar al sistema</a></p>`
    : "";
  const correo = await enviarCorreo(
    d,
    sol.correo,
    `Tu solicitud de afiliación para ${nombre} fue aprobada`,
    cajaCorreo(`
    <h2>¡Hola, ${e(sol.nombre_contacto)}!</h2>
    <p>La solicitud de afiliación de <strong>${e(nombre)}</strong> fue aprobada.</p>
    <p>Estas son tus credenciales de acceso:</p>
    <ul>
      <li><strong>Agencia:</strong> ${e(nombre)}</li>
      <li><strong>Código de agencia:</strong> ${e(codigo.toUpperCase())}</li>
      <li><strong>Usuario (correo):</strong> ${e(sol.correo)}</li>
      <li><strong>Contraseña temporal:</strong> ${e(password)}</li>
    </ul>
    ${enlace}
    <p>Guarda esta información en un lugar seguro.</p>`),
  );

  return responder(d.env, 200, {
    ok: true,
    agencia_id: agenciaId,
    correo_enviado: correo.enviado,
    aviso_correo: correo.aviso ?? null,
  });
}

async function rechazar(body: any, admin: any, d: Deps) {
  const solicitudId = String(body.solicitud_id ?? "");
  const motivo = String(body.motivo ?? "").trim();
  if (!UUID.test(solicitudId))
    return responder(d.env, 400, { error: "Solicitud no válida." });
  if (motivo.length < 3 || motivo.length > 500)
    return responder(d.env, 400, {
      error: "El motivo debe tener entre 3 y 500 caracteres.",
    });

  // Con la identidad del administrador: la base de datos registra quién rechazó y cuándo
  const { data, error } = await d
    .clienteUsuario(admin.auth)
    .from("solicitudes_afiliacion")
    .update({ estado: "rechazada", motivo_rechazo: motivo })
    .eq("id", solicitudId)
    .eq("estado", "pendiente")
    .select("correo, nombre_contacto, nombre_negocio");
  if (error) {
    console.error("rechazo falló:", error.code);
    return responder(d.env, error.code === "23514" ? 400 : 500, {
      error: "No se pudo rechazar la solicitud.",
    });
  }
  if (!data?.length)
    return responder(d.env, 409, {
      error: "La solicitud no existe o ya fue resuelta.",
    });

  const s = data[0];
  const e = escapeHtml;
  const correo = await enviarCorreo(
    d,
    s.correo,
    `Actualización sobre tu solicitud de afiliación para ${s.nombre_negocio}`,
    cajaCorreo(`
    <h2>Hola, ${e(s.nombre_contacto)}:</h2>
    <p>Tu solicitud de afiliación para <strong>${e(s.nombre_negocio)}</strong> no pudo ser aprobada en esta ocasión.</p>
    <p><strong>Motivo:</strong></p>
    <p style="background:#f6f6f6;padding:12px;border-left:4px solid #dc2626;border-radius:4px">${e(motivo)}</p>
    <p>Gracias por tu interés en formar parte de nuestra red.</p>`),
  );

  return responder(d.env, 200, {
    ok: true,
    correo_enviado: correo.enviado,
    aviso_correo: correo.aviso ?? null,
  });
}

export async function manejar(req: Request, d: Deps): Promise<Response> {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cabeceras(d.env) });
  if (req.method !== "POST")
    return responder(d.env, 405, { error: "Método no permitido." });

  const admin = await exigirAdmin(req, d);
  if (!admin.ok)
    return responder(d.env, admin.status as number, { error: admin.mensaje });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return responder(d.env, 400, { error: "Solicitud mal formada." });
  }
  if (!body || typeof body !== "object")
    return responder(d.env, 400, { error: "Solicitud mal formada." });

  if (body.accion === "aprobar") return aprobar(body, admin, d);
  if (body.accion === "rechazar") return rechazar(body, admin, d);
  return responder(d.env, 400, { error: "Acción no válida." });
}

/* Arranque dentro de Supabase. En las pruebas con Node esta parte no se ejecuta. */
const entornoDeno = (globalThis as any).Deno;
if (entornoDeno?.serve) {
  const { createClient } = await import("npm:@supabase/supabase-js@2.117.1");
  const get = (k: string) => entornoDeno.env.get(k);
  const env: Env = {
    SUPABASE_URL: get("SUPABASE_URL"),
    SUPABASE_ANON_KEY: get("SUPABASE_ANON_KEY"),
    RESEND_API_KEY: get("RESEND_API_KEY"),
    EMAIL_FROM: get("EMAIL_FROM"),
    ALLOWED_ORIGIN: get("ALLOWED_ORIGIN"),
    APP_URL: get("APP_URL"),
  };
  const sinSesion = {
    auth: { persistSession: false, autoRefreshToken: false },
  };
  const servicio = createClient(
    env.SUPABASE_URL,
    get("SUPABASE_SERVICE_ROLE_KEY"),
    sinSesion,
  );
  entornoDeno.serve((req: Request) =>
    manejar(req, {
      env,
      clienteUsuario: (authorization: string) =>
        createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, {
          ...sinSesion,
          global: { headers: { Authorization: authorization } },
        }),
      clienteServicio: servicio,
      fetch,
    }),
  );
}
