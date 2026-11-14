import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm";
import { SUPABASE_CONFIG } from "../../core/js/config.js";

const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
window.supabase = supabase;

const FUNCION_AFILIACIONES = "afiliaciones";
const BUCKET_LOGOS = "logos-agencias";
const BUCKET_EVIDENCIAS = "evidencias-solicitudes";
const TIPOS_LOGO = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCIA_BYTES = 3 * 1024 * 1024;

const TARIFA_DEFAULT = {
  aereo: 5.5,
  maritimo: 2.5,
  ultra: 4.0,
};

const ESTADO_ENVIO_OPTIONS = [
  { value: "consolidacion_miami", label: "En Consolidación Miami" },
  { value: "despachado_miami", label: "Despachado a Almacén Miami" },
  { value: "transito_managua", label: "Tránsito a Managua" },
  { value: "recibido_managua", label: "Recibido Almacén Managua" },
  { value: "entregado", label: "Entregado" },
];

function textoEstadoEnvio(val) {
  const k = String(val || "consolidacion_miami")
    .toLowerCase()
    .trim();
  const found = ESTADO_ENVIO_OPTIONS.find((o) => o.value === k);
  return found ? found.label : val || "—";
}

function selectEstadoEnvioHtml(corteId, valorActual) {
  const actual = String(valorActual || "consolidacion_miami")
    .toLowerCase()
    .trim();
  const opts = ESTADO_ENVIO_OPTIONS.map((o) => {
    const sel = o.value === actual ? " selected" : "";
    return `<option value="${o.value}"${sel}>${o.label}</option>`;
  }).join("");
  return `<select class="form-input select-estado-envio" data-id="${escapeHtml(String(corteId))}" data-estado="${escapeHtml(actual)}">${opts}</select>`;
}

let agenciasCache = [];
let vistaSeleccionadaAnterior = "global";
let cortesCache = [];
let corteActualBultos = null;
let tarifaActualBultos = 0;
let chartIngresos = null;
let solicitudesSucursalCache = [];

// Rol de sesión (admin | operador)
let rolUsuario = "operador";
const VISTAS_OPERADOR = new Set(["view-cortes", "view-solicitudes-sucursal", "view-reportes", "view-liquidacion"]);

async function cargarPerfilSesion() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session) {
    window.location.href = "../../../index.html";
    return null;
  }

  const { data: perfil, error: errPerfil } = await supabase
    .from("perfiles")
    .select("rol, activo, nombre")
    .eq("id", session.user.id)
    .maybeSingle();

  if (errPerfil) {
    console.error("Error perfil:", errPerfil);
    await mostrarAlerta(
      "Error",
      "No se pudo verificar tu perfil. Contacta al administrador.",
    );
    return null;
  }

  if (!perfil) {
    await mostrarAlerta(
      "Sin perfil",
      "Tu usuario no tiene perfil asignado en el sistema.",
    );
    await supabase.auth.signOut();
    window.location.href = "../../../index.html";
    return null;
  }

  if (perfil.activo === false) {
    await mostrarAlerta("Cuenta inactiva", "Tu usuario está desactivado.");
    await supabase.auth.signOut();
    window.location.href = "../../../index.html";
    return null;
  }

  const rol = String(perfil.rol || "").toLowerCase();

  if (rol !== "admin" && rol !== "operador") {
    await mostrarAlerta(
      "Acceso denegado",
      "Este panel es solo para personal interno (admin u operador).",
    );
    await supabase.auth.signOut();
    window.location.href = "../../../index.html";
    return null;
  }

  rolUsuario = rol;
  return { session, perfil, rol };
}

function aplicarPermisosPorRol(rol) {
  const esOperador = rol === "operador";

  document.querySelectorAll(".nav-link[data-target]").forEach((link) => {
    const target = link.getAttribute("data-target");
    if (esOperador && !VISTAS_OPERADOR.has(target)) {
      link.style.display = "none";
      link.setAttribute("data-bloqueado", "1");
    } else {
      link.style.display = "";
      link.removeAttribute("data-bloqueado");
    }
  });

  const badge = document.querySelector(".sidebar-badge");
  if (badge) {
    badge.textContent = esOperador ? "OPERACIONES" : "ADMINISTRACIÓN GLOBAL";
  }

  if (esOperador) {
    document.querySelectorAll(".dashboard-view").forEach((v) => {
      v.hidden = v.id !== "view-cortes";
    });
    document.querySelectorAll(".nav-link").forEach((l) => {
      const t = l.getAttribute("data-target");
      const activo = t === "view-cortes";
      l.classList.toggle("active", activo);
      if (activo) l.setAttribute("aria-current", "page");
      else l.removeAttribute("aria-current");
    });
    const pageTitle = $("page-title");
    if (pageTitle) pageTitle.textContent = "Contenedores y cortes";
  }
}

function $(id) {
  return document.getElementById(id);
}

function show(el) {
  if (!el) return;
  el.hidden = false;
  if (el.classList.contains("modal-overlay")) {
    el.style.display = "flex";
  }
}

function hide(el) {
  if (!el) return;
  el.hidden = true;
  if (el.classList.contains("modal-overlay")) {
    el.style.display = "none";
  }
}

function openModal(id) {
  show($(id));
}

function closeModal(id) {
  hide($(id));
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach((m) => hide(m));
}

const safeText = (value, fallback = "") => {
  const text = value == null ? "" : String(value).trim();
  return text || fallback;
};

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });

function parseTarifa(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function tarifaPorTipoEnvio(agencia, tipoEnvio) {
  if (!agencia) {
    const t = (tipoEnvio || "").toLowerCase();
    if (t.includes("mar")) return TARIFA_DEFAULT.maritimo;
    if (t.includes("ultra")) return TARIFA_DEFAULT.ultra;
    return TARIFA_DEFAULT.aereo;
  }
  const t = (tipoEnvio || "").toLowerCase();
  if (t.includes("aér") || t.includes("aer")) {
    return parseTarifa(agencia.tarifa_aereo, TARIFA_DEFAULT.aereo);
  }
  if (t.includes("mar")) {
    return parseTarifa(agencia.tarifa_maritimo, TARIFA_DEFAULT.maritimo);
  }
  if (t.includes("ultra")) {
    return parseTarifa(agencia.tarifa_ultra, TARIFA_DEFAULT.ultra);
  }
  return parseTarifa(agencia.tarifa_aereo, TARIFA_DEFAULT.aereo);
}

function formatMoney(n) {
  return `$${parseFloat(n || 0).toFixed(2)}`;
}

function badgeHtml(estado) {
  const e = (estado || "").toLowerCase();
  if (
    e === "activo" ||
    e === "activa" ||
    e === "aprobado" ||
    e === "pagado" ||
    e === "entregado" ||
    e === "resuelto"
  ) {
    return `<span class="badge badge-success">${escapeHtml(estado || "Activo")}</span>`;
  }
  if (e === "inactivo" || e === "inactiva" || e === "rechazado") {
    return `<span class="badge badge-danger">${escapeHtml(estado || "Inactivo")}</span>`;
  }
  if (e === "recibido" || e === "en_proceso") {
    return `<span class="badge badge-info">${escapeHtml(e === "en_proceso" ? "En proceso" : estado)}</span>`;
  }
  return `<span class="badge badge-warning">${escapeHtml(estado || "Pendiente")}</span>`;
}

function getAgenciaVistaActual() {
  if (!vistaSeleccionadaAnterior || vistaSeleccionadaAnterior === "global") {
    return null;
  }
  return (
    agenciasCache.find(
      (a) => String(a.id) === String(vistaSeleccionadaAnterior),
    ) || null
  );
}

function actualizarTituloCortes() {
  const titleEl = $("cortes-title");
  if (!titleEl) return;
  const ag = getAgenciaVistaActual();
  if (ag) {
    titleEl.textContent = `Contenedores de ${ag.nombre || "agencia"} (${ag.codigo || ""})`;
  } else {
    titleEl.textContent = "Contenedores de todas las agencias";
  }
}

function sincronizarSelectCorteConVista() {
  const corteSelect = $("corte-agencia-select");
  if (!corteSelect) return;
  const ag = getAgenciaVistaActual();
  if (ag) {
    corteSelect.value = String(ag.id);
  }
}

function fechaCorteKey(corte) {
  const raw =
    corte?.fecha_corte ||
    corte?.fecha_estimada ||
    corte?.created_at ||
    corte?.creada_en ||
    null;
  if (!raw) return null;
  const s = String(raw).trim();
  // Fecha calendario YYYY-MM-DD sin pasar por UTC (evita -1 día)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s.slice(0, 10);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  } catch {
    return s.slice(0, 10);
  }
}

function fechaCorteTexto(corte) {
  const key = fechaCorteKey(corte);
  if (!key) return "Pendiente";
  const m = String(key).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return key;
}

function mostrarAlerta(titulo, mensaje) {
  return new Promise((resolve) => {
    const modal = $("custom-alert-modal");
    const titleEl = $("custom-alert-title");
    const msgEl = $("custom-alert-message");
    const btn = $("custom-alert-btn");

    if (titleEl) titleEl.textContent = titulo;
    if (msgEl) msgEl.textContent = mensaje;
    show(modal);

    const handler = () => {
      hide(modal);
      btn?.removeEventListener("click", handler);
      resolve(true);
    };
    if (btn) {
      btn.onclick = null;
      btn.addEventListener("click", handler, { once: true });
    }
  });
}

function mostrarConfirmacion(titulo, mensaje) {
  return new Promise((resolve) => {
    const modal = $("custom-confirm-modal");
    const titleEl = $("custom-confirm-title");
    const msgEl = $("custom-confirm-message");
    const btnYes = $("custom-confirm-yes");
    const btnNo = $("custom-confirm-no");

    if (titleEl) titleEl.textContent = titulo;
    if (msgEl) msgEl.textContent = mensaje;
    show(modal);

    const cleanUp = (resultado) => {
      hide(modal);
      if (btnYes) btnYes.onclick = null;
      if (btnNo) btnNo.onclick = null;
      resolve(resultado);
    };

    if (btnYes) btnYes.onclick = () => cleanUp(true);
    if (btnNo) btnNo.onclick = () => cleanUp(false);
  });
}

function setupNavegacion() {
  const navLinks = document.querySelectorAll(".nav-link");
  const views = document.querySelectorAll(".dashboard-view");
  const pageTitle = $("page-title");

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();

      const targetId = link.getAttribute("data-target");

      if (rolUsuario === "operador" && !VISTAS_OPERADOR.has(targetId)) {
        mostrarAlerta(
          "Acceso restringido",
          "Tu usuario de operador solo puede usar Contenedores y cortes y Solicitudes de sucursal.",
        );
        return;
      }

      navLinks.forEach((l) => {
        l.classList.remove("active");
        l.removeAttribute("aria-current");
      });
      link.classList.add("active");
      link.setAttribute("aria-current", "page");

      views.forEach((v) => {
        v.hidden = v.id !== targetId;
      });

      if (pageTitle) {
        const span = link.querySelector("span");
        pageTitle.textContent = span
          ? span.textContent.trim()
          : link.textContent.trim();
      }

      if (targetId === "view-reportes") prepararReportesOperativos();
      if (targetId === "view-liquidacion") prepararLiquidacion();
      if (targetId === "view-solicitudes-sucursal") {
        cargarSolicitudesSucursal();
      }
    });
  });
}

function setupModalesGlobales() {
  document.querySelectorAll("[data-cerrar]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const overlay = btn.closest(".modal-overlay");
      if (overlay) hide(overlay);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
  });
}

function setupLogout() {
  $("logout-btn")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "../../../index.html";
  });
}

async function refreshAllData() {
  await cargarDashboardResumen();
  await loadSolicitudesPendientes();
  await cargarSolicitudesSucursal();
  await loadAgenciasAprobadas();
  await poblarSelectorAgencias();
  await cargarCortesGlobalesAdmin();
}

// ============================================================
// DASHBOARD RESUMEN
// ============================================================
async function cargarDashboardResumen() {
  try {
    const agVista = getAgenciaVistaActual();

    const [
      { data: agencias },
      { data: solicitudes },
      { data: cortes },
      { count: countBultos },
      { count: countSolSuc },
    ] = await Promise.all([
      supabase.from("agencias").select("*"),
      supabase
        .from("solicitudes_afiliacion")
        .select("id", { count: "exact" })
        .eq("estado", "pendiente"),
      supabase.from("cortes_contenedores").select("*"),
      supabase
        .from("paquetes_bultos")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("solicitudes_sucursal")
        .select("*", { count: "exact", head: true })
        .eq("estado", "pendiente"),
    ]);

    agenciasCache = agencias || [];
    let listaCortes = cortes || [];

    if (agVista) {
      listaCortes = listaCortes.filter(
        (c) => String(c.agencia_id) === String(agVista.id),
      );
    }

    const agenciasActivas = agenciasCache.filter(
      (a) => (a.estado || "activo") === "activo",
    ).length;

    const pendientesAfil = solicitudes?.length ?? 0;
    const pendientesSuc = countSolSuc ?? 0;
    const pendientesSol = pendientesAfil + pendientesSuc;

    const abiertos = listaCortes.filter((c) => {
      const e = (c.estado || "Pendiente").toLowerCase();
      return e === "pendiente" || e === "recibido" || e === "abierto";
    }).length;

    // ========== RANGO DE FECHAS (últimos 30 días + fechas futuras si existen) ==========
    const ahora = new Date();
    const hace30 = new Date(ahora);
    hace30.setDate(hace30.getDate() - 29);
    hace30.setHours(0, 0, 0, 0);

    let ingresos30 = 0;
    let saldoCobrar = 0;
    const porDia = {};

    // Generamos las 30 fechas en hora local
    for (let i = 0; i < 30; i++) {
      const d = new Date(hace30);
      d.setDate(hace30.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      porDia[`${y}-${m}-${day}`] = 0;
    }

    const porAgencia = {};

    listaCortes.forEach((c) => {
      const costo = parseFloat(c.costo_total || 0);
      const pagado = parseFloat(c.total_pagado || 0);
      saldoCobrar += Math.max(0, costo - pagado);

      const key = fechaCorteKey(c);

      if (key) {
        // Si la fecha no está en el rango de 30 días, la agregamos igual
        if (porDia[key] === undefined) {
          porDia[key] = 0;
        }
        porDia[key] += costo;

        // Sumamos a ingresos30 si está dentro de los últimos 30 días o es futura cercana
        try {
          const fd = new Date(key + "T12:00:00");
          if (!Number.isNaN(fd.getTime()) && fd >= hace30) {
            ingresos30 += costo;
          }
        } catch {
          ingresos30 += costo;
        }
      }

      const aid = c.agencia_id || "sin";
      if (!porAgencia[aid]) {
        porAgencia[aid] = { id: aid, cortes: 0, costo: 0 };
      }
      porAgencia[aid].cortes += 1;
      porAgencia[aid].costo += costo;
    });

    // Actualizar tarjetas
    if ($("stat-agencias"))
      $("stat-agencias").textContent = String(agenciasActivas);
    if ($("stat-solicitudes"))
      $("stat-solicitudes").textContent = String(pendientesSol);
    if ($("stat-cortes")) $("stat-cortes").textContent = String(abiertos);
    if ($("stat-bultos"))
      $("stat-bultos").textContent = String(countBultos ?? 0);
    if ($("stat-ingresos-30"))
      $("stat-ingresos-30").textContent = formatMoney(ingresos30);
    if ($("stat-saldo-cobrar"))
      $("stat-saldo-cobrar").textContent = formatMoney(saldoCobrar);

    // Ordenar las fechas y renderizar el gráfico
    const labels = Object.keys(porDia).sort();
    const values = labels.map((k) => porDia[k]);

    renderChartIngresos(
      labels.map((k) => {
        const parts = k.split("-");
        return `${parts[2]}/${parts[1]}`;
      }),
      values,
    );

    renderRankingAgencias(porAgencia);
    renderEstadosContenedores(listaCortes);
    renderActividadReciente(listaCortes);
  } catch (err) {
    console.error("Error dashboard resumen:", err);
  }
}

function renderChartIngresos(labels, values) {
  const canvas = $("chart-ingresos-30");
  if (!canvas || typeof Chart === "undefined") return;

  if (chartIngresos) {
    chartIngresos.destroy();
    chartIngresos = null;
  }

  chartIngresos = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Ingresos ($)",
          data: values,
          borderColor: "#1e293b",
          backgroundColor: "rgba(30, 41, 59, 0.08)",
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: "#1e293b",
          fill: true,
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => formatMoney(ctx.parsed.y),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 8, font: { size: 11 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: {
            font: { size: 11 },
            callback: (v) => "$" + v,
          },
        },
      },
    },
  });
}

function renderRankingAgencias(porAgencia) {
  const tbody = $("tabla-ranking-agencias");
  if (!tbody) return;

  const rows = Object.values(porAgencia)
    .map((r) => {
      const ag = agenciasCache.find((a) => String(a.id) === String(r.id));
      return {
        nombre: ag?.nombre || (r.id === "sin" ? "Sin agencia" : "Agencia"),
        codigo: ag?.codigo || "",
        cortes: r.cortes,
        costo: r.costo,
      };
    })
    .sort((a, b) => b.costo - a.costo)
    .slice(0, 5);

  if (rows.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Sin movimiento aún.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${i + 1}</strong></td>
      <td>
        ${escapeHtml(r.nombre)}
        ${r.codigo ? `<span class="cell-muted"> ${escapeHtml(r.codigo)}</span>` : ""}
      </td>
      <td>${r.cortes}</td>
      <td><strong>${formatMoney(r.costo)}</strong></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderEstadosContenedores(cortes) {
  const counts = {
    pendiente: 0,
    recibido: 0,
    entregado: 0,
    pagado: 0,
  };

  (cortes || []).forEach((c) => {
    const e = (c.estado || "Pendiente").toLowerCase();
    if (e === "recibido") counts.recibido++;
    else if (e === "entregado") counts.entregado++;
    else if (e === "pagado" || e === "cerrado") counts.pagado++;
    else counts.pendiente++;
  });

  const total = Math.max(
    1,
    counts.pendiente + counts.recibido + counts.entregado + counts.pagado,
  );

  const setBar = (key, n) => {
    const bar = $(`bar-${key}`);
    const cnt = $(`count-${key}`);
    if (cnt) cnt.textContent = String(n);
    if (bar) bar.style.width = `${Math.round((n / total) * 100)}%`;
  };

  setBar("pendiente", counts.pendiente);
  setBar("recibido", counts.recibido);
  setBar("entregado", counts.entregado);
  setBar("pagado", counts.pagado);
}

function renderActividadReciente(cortes) {
  const lista = $("lista-actividad-reciente");
  if (!lista) return;

  const sorted = [...(cortes || [])]
    .sort((a, b) => {
      const da = new Date(a.created_at || a.creada_en || a.fecha_corte || 0);
      const db = new Date(b.created_at || b.creada_en || b.fecha_corte || 0);
      return db - da;
    })
    .slice(0, 8);

  if (sorted.length === 0) {
    lista.innerHTML = `<li class="empty-msg">No hay actividad reciente.</li>`;
    return;
  }

  lista.innerHTML = "";
  sorted.forEach((c) => {
    const ag = agenciasCache.find((a) => String(a.id) === String(c.agencia_id));
    const nombre = ag?.nombre || "Agencia";
    const fecha = fechaCorteKey(c) || "--";
    const li = document.createElement("li");
    li.className = "activity-item";
    li.innerHTML = `
      <div class="activity-item__main">
        <strong>${escapeHtml(c.tipo_envio || "Corte")} · ${escapeHtml(String(c.numero_corte || "N/D"))}</strong>
        <span class="cell-muted">${escapeHtml(nombre)}</span>
      </div>
      <div class="activity-item__meta">
        ${badgeHtml(c.estado || "Pendiente")}
        <span class="cell-muted">${escapeHtml(fecha)}</span>
      </div>
    `;
    lista.appendChild(li);
  });
}

async function cargarEstadisticasResumen() {
  await cargarDashboardResumen();
}

async function invocarAfiliaciones(body) {
  const { data, error } = await supabase.functions.invoke(
    FUNCION_AFILIACIONES,
    { body },
  );
  if (error) {
    let mensaje = "No se pudo completar la operación. Revisa tu conexión.";
    try {
      const respuesta = await error.context.json();
      if (respuesta?.error) mensaje = respuesta.error;
    } catch {}
    throw new Error(mensaje);
  }
  return data;
}

async function actualizarAgenciaPostAprobacion(codigo, payload) {
  let data = { ...payload };
  let lastError = null;

  for (let intento = 0; intento < 8; intento++) {
    const { error } = await supabase
      .from("agencias")
      .update(data)
      .eq("codigo", codigo);

    if (!error) return { ok: true, error: null };

    lastError = error;
    const msg = String(error.message || "");
    console.warn("Update agencias (intento)", intento + 1, msg);

    const match = msg.match(/['"]([a-z_]+)['"] column/i);
    if (
      match &&
      match[1] &&
      Object.prototype.hasOwnProperty.call(data, match[1])
    ) {
      delete data[match[1]];
      continue;
    }

    if (msg.includes("departamento") && data.departamento !== undefined) {
      delete data.departamento;
      continue;
    }
    if (msg.includes("nombre_contacto") && data.nombre_contacto !== undefined) {
      delete data.nombre_contacto;
      continue;
    }
    if (msg.includes("celular") && data.celular !== undefined) {
      delete data.celular;
      continue;
    }
    if (
      msg.includes("password_temporal") &&
      data.password_temporal !== undefined
    ) {
      delete data.password_temporal;
      continue;
    }
    if (msg.includes("logo_url") && data.logo_url !== undefined) {
      delete data.logo_url;
      continue;
    }
    if (msg.includes("tarifa_")) {
      ["tarifa_aereo", "tarifa_maritimo", "tarifa_ultra"].forEach((k) => {
        if (msg.includes(k) && data[k] !== undefined) delete data[k];
      });
      continue;
    }

    break;
  }

  return { ok: false, error: lastError };
}

async function subirLogo(file, codigo) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!TIPOS_LOGO[ext] || !Object.values(TIPOS_LOGO).includes(file.type)) {
    return { url: null, aviso: "El logo debe ser una imagen PNG, JPG o WEBP." };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { url: null, aviso: "El logo pesa más de 2 MB." };
  }

  const base =
    (codigo || "agencia").toLowerCase().replace(/[^a-z0-9-]/g, "") || "agencia";
  const nombreArchivo = `agencia_${base}_${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET_LOGOS)
    .upload(nombreArchivo, file, {
      contentType: file.type,
      upsert: true,
    });

  if (error) {
    console.error("Error Storage logos:", error);
    return {
      url: null,
      aviso: `No se pudo subir el logo: ${error.message || "revisa bucket y políticas"}`,
    };
  }

  const { data } = supabase.storage
    .from(BUCKET_LOGOS)
    .getPublicUrl(nombreArchivo);
  return { url: data?.publicUrl || null, aviso: null };
}

function actualizarBannerAgencia(agencia) {
  const banner = $("agency-banner");
  const nameEl = $("agency-banner-name");
  if (!banner) return;

  if (!agencia) {
    hide(banner);
    if (nameEl) nameEl.textContent = "";
    return;
  }

  if (nameEl)
    nameEl.textContent = `${agencia.nombre || ""} (${agencia.codigo || ""})`;
  show(banner);
}

function setupAgencySwitcher() {
  const select = $("agency-switcher");
  const exitBtn = $("exit-agency-btn");

  select?.addEventListener("change", async () => {
    const val = select.value || "global";
    if (val !== "global" && val !== vistaSeleccionadaAnterior) {
      const ag = agenciasCache.find((a) => String(a.id) === String(val));
      const ok = await mostrarConfirmacion(
        "Cambiar vista",
        `¿Entrar a la vista de ${ag?.nombre || "esta agencia"}?`,
      );
      if (!ok) {
        select.value = vistaSeleccionadaAnterior;
        return;
      }
    }
    vistaSeleccionadaAnterior = val;
    const ag = getAgenciaVistaActual();
    actualizarBannerAgencia(ag);
    actualizarTituloCortes();
    sincronizarSelectCorteConVista();
    await refreshAllData();
  });

  exitBtn?.addEventListener("click", async () => {
    vistaSeleccionadaAnterior = "global";
    if (select) select.value = "global";
    actualizarBannerAgencia(null);
    actualizarTituloCortes();
    await refreshAllData();
  });
}

async function loadAgenciasAprobadas() {
  const tbody = $("agencias-table-body");
  if (!tbody) return;

  const { data: agencias, error } = await supabase
    .from("agencias")
    .select("*")
    .order("nombre", { ascending: true });

  if (error) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Error: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  agenciasCache = agencias || [];

  if (!agencias || agencias.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No hay agencias registradas.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  agencias.forEach((ag) => {
    const estado = ag.estado || "activo";
    const esActivo = estado === "activo" || estado === "Activa";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(ag.codigo || "—")}</strong></td>
      <td>${escapeHtml(ag.nombre || "—")}</td>
      <td>${escapeHtml(ag.contacto || ag.nombre_contacto || "—")}<br><span class="cell-muted">${escapeHtml(ag.telefono || ag.celular || "")}</span></td>
      <td>${escapeHtml(ag.correo || ag.email || "—")}</td>
      <td>${badgeHtml(estado)}</td>
      <td>
        <div class="actions-cell">
          <button type="button" class="btn-secondary btn-sm btn-ver-agencia" data-id="${escapeHtml(String(ag.id))}">Ver</button>
          <button type="button" class="btn-secondary btn-sm btn-entrar-agencia" data-id="${escapeHtml(String(ag.id))}">
            <svg class="icon" aria-hidden="true"><use href="#i-enter"></use></svg>
            Entrar
          </button>
          <button type="button" class="${esActivo ? "btn-danger" : "btn-primary"} btn-sm btn-toggle-agencia"
            data-id="${escapeHtml(String(ag.id))}" data-estado="${escapeHtml(estado)}">
            ${esActivo ? "Desactivar" : "Activar"}
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btn-ver-agencia").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ag = agenciasCache.find(
        (a) => String(a.id) === btn.getAttribute("data-id"),
      );
      if (!ag) return;
      if ($("det-nombre")) $("det-nombre").textContent = ag.nombre || "—";
      if ($("det-codigo")) $("det-codigo").textContent = ag.codigo || "—";
      if ($("det-contacto"))
        $("det-contacto").textContent =
          ag.contacto || ag.nombre_contacto || "—";
      if ($("det-telefono"))
        $("det-telefono").textContent = ag.telefono || ag.celular || "—";
      if ($("det-departamento"))
        $("det-departamento").textContent = ag.departamento || "—";
      if ($("det-direccion"))
        $("det-direccion").textContent = ag.direccion || "—";
      if ($("det-correo"))
        $("det-correo").textContent = ag.correo || ag.email || "—";
      if ($("det-estado")) $("det-estado").innerHTML = badgeHtml(ag.estado);
      if ($("det-tarifa-aereo"))
        $("det-tarifa-aereo").textContent = formatMoney(
          ag.tarifa_aereo ?? TARIFA_DEFAULT.aereo,
        );
      if ($("det-tarifa-maritimo"))
        $("det-tarifa-maritimo").textContent = formatMoney(
          ag.tarifa_maritimo ?? TARIFA_DEFAULT.maritimo,
        );
      if ($("det-tarifa-ultra"))
        $("det-tarifa-ultra").textContent = formatMoney(
          ag.tarifa_ultra ?? TARIFA_DEFAULT.ultra,
        );
      const wrap = $("det-logo-wrap");
      const img = $("det-logo");
      if (wrap && img) {
        if (ag.logo_url) {
          img.src = ag.logo_url;
          wrap.hidden = false;
        } else {
          wrap.hidden = true;
        }
      }
      openModal("modal-detalle-agencia");
    });
  });

  tbody.querySelectorAll(".btn-entrar-agencia").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const select = $("agency-switcher");
      if (select) {
        select.value = id;
        select.dispatchEvent(new Event("change"));
      }
    });
  });

  tbody.querySelectorAll(".btn-toggle-agencia").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const estadoActual = (
        btn.getAttribute("data-estado") || ""
      ).toLowerCase();
      const nuevoEstado =
        estadoActual === "activo" || estadoActual === "activa"
          ? "inactivo"
          : "activo";
      const ok = await mostrarConfirmacion(
        "Cambiar estado",
        `¿${nuevoEstado === "activo" ? "Activar" : "Desactivar"} esta agencia?`,
      );
      if (!ok) return;
      const { error } = await supabase
        .from("agencias")
        .update({ estado: nuevoEstado })
        .eq("id", id);
      if (error) {
        await mostrarAlerta("Error", error.message);
        return;
      }
      await mostrarAlerta(
        "Éxito",
        `Agencia ${nuevoEstado === "activo" ? "activada" : "desactivada"}.`,
      );
      await refreshAllData();
    });
  });
}

async function poblarSelectorAgencias() {
  const switcher = $("agency-switcher");
  const corteSelect = $("corte-agencia-select");

  const { data: agencias } = await supabase
    .from("agencias")
    .select("*")
    .order("nombre", { ascending: true });

  agenciasCache = agencias || [];

  if (switcher) {
    const current = switcher.value || "global";
    switcher.innerHTML = `<option value="global">Administrador global (todas)</option>`;
    agenciasCache.forEach((ag) => {
      const opt = document.createElement("option");
      opt.value = String(ag.id);
      opt.textContent = `${ag.nombre || "Agencia"} (${ag.codigo || "—"})`;
      switcher.appendChild(opt);
    });
    switcher.value = current;
  }

  if (corteSelect) {
    const prev = corteSelect.value;
    corteSelect.innerHTML = `<option value="">Seleccionar agencia...</option>`;
    agenciasCache.forEach((ag) => {
      const opt = document.createElement("option");
      opt.value = String(ag.id);
      opt.textContent = `${ag.nombre || "Agencia"} (${ag.codigo || "—"})`;
      corteSelect.appendChild(opt);
    });
    if (prev) corteSelect.value = prev;
    sincronizarSelectCorteConVista();
  }
}

async function cargarCortesGlobalesAdmin() {
  const tbody = $("tabla-admin-cortes-body");
  if (!tbody) return;

  actualizarTituloCortes();

  const agVista = getAgenciaVistaActual();

  async function fetchCortes(orderCol) {
    let query = supabase.from("cortes_contenedores").select("*");
    if (agVista) query = query.eq("agencia_id", agVista.id);
    if (orderCol) query = query.order(orderCol, { ascending: false });
    return query;
  }

  let cortes = null;
  let error = null;

  for (const col of ["fecha_corte", "created_at", "creada_en"]) {
    const res = await fetchCortes(col);
    if (!res.error) {
      cortes = res.data;
      error = null;
      break;
    }
    const msg = String(res.error.message || "");
    if (msg.includes("does not exist") || msg.includes("column")) {
      error = res.error;
      continue;
    }
    error = res.error;
    break;
  }

  if (error || cortes == null) {
    let query = supabase.from("cortes_contenedores").select("*");
    if (agVista) query = query.eq("agencia_id", agVista.id);
    const res = await query;
    cortes = res.data;
    error = res.error;
  }

  if (error) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">Error: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  cortesCache = cortes || [];

  if (!cortes || cortes.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">No hay contenedores.</td></tr>`;
    return;
  }

  cortes.sort((a, b) => {
    const da = new Date(
      a.fecha_corte || a.created_at || a.creada_en || 0,
    ).getTime();
    const db = new Date(
      b.fecha_corte || b.created_at || b.creada_en || 0,
    ).getTime();
    return db - da;
  });

  const ids = cortes.map((c) => c.id).filter(Boolean);
  const statsMap = {};
  if (ids.length > 0) {
    const { data: bultosRows } = await supabase
      .from("paquetes_bultos")
      .select("corte_id, peso_lbs")
      .in("corte_id", ids);
    (bultosRows || []).forEach((b) => {
      const k = String(b.corte_id);
      if (!statsMap[k]) statsMap[k] = { n: 0, lbs: 0 };
      statsMap[k].n += 1;
      statsMap[k].lbs += parseFloat(b.peso_lbs) || 0;
    });
  }

  tbody.innerHTML = "";
  cortes.forEach((c) => {
    const ag = agenciasCache.find((a) => String(a.id) === String(c.agencia_id));
    const st = statsMap[String(c.id)] || { n: 0, lbs: 0 };
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(ag?.nombre || c.agencia_id || "—")}</td>
      <td>${escapeHtml(c.tipo_envio || "—")}</td>
      <td>
        Corte ${escapeHtml(c.numero_corte || "N/D")}
        ${c.codigo_ref ? `<br><small class="cell-muted">#${escapeHtml(c.codigo_ref)}</small>` : ""}
      </td>
      <td>${escapeHtml(fechaCorteTexto(c))}</td>
      <td><strong>${st.n}</strong></td>
      <td>${st.lbs.toFixed(2)} lb</td>
      <td><strong>${formatMoney(c.costo_total)}</strong></td>
      <td>${badgeHtml(c.estado || "Pendiente")}</td>
      <td>${selectEstadoEnvioHtml(c.id, c.estado_envio)}</td>
      <td>
        <div class="actions-cell">
          <button type="button" class="btn-secondary btn-sm btn-gestionar-bultos" data-id="${escapeHtml(String(c.id))}">Bultos</button>
          <button type="button" class="btn-danger btn-sm btn-eliminar-corte" data-id="${escapeHtml(String(c.id))}">Eliminar</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".select-estado-envio").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const id = e.target.getAttribute("data-id");
      const nuevo = e.target.value;
      const prev = e.target.dataset.prev || "consolidacion_miami";
      const { error: upErr } = await supabase
        .from("cortes_contenedores")
        .update({ estado_envio: nuevo })
        .eq("id", id);
      if (upErr) {
        e.target.value = prev;
        await mostrarAlerta(
          "Error",
          "No se pudo actualizar el seguimiento: " + upErr.message,
        );
        return;
      }
      e.target.dataset.prev = nuevo;
      e.target.setAttribute("data-estado", nuevo);
      const corte = cortesCache.find((c) => String(c.id) === String(id));
      if (corte) corte.estado_envio = nuevo;
      await mostrarAlerta(
        "Éxito",
        "Seguimiento actualizado: " + textoEstadoEnvio(nuevo),
      );
    });
    sel.dataset.prev = sel.value;
  });

  tbody.querySelectorAll(".btn-gestionar-bultos").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const corte = cortesCache.find((c) => String(c.id) === String(id));
      if (corte) await abrirModalGestionBultos(corte);
    });
  });

  tbody.querySelectorAll(".btn-eliminar-corte").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const ok = await mostrarConfirmacion(
        "Eliminar contenedor",
        "¿Eliminar este contenedor de forma permanente?",
      );
      if (!ok) return;
      const { error: delErr } = await supabase
        .from("cortes_contenedores")
        .delete()
        .eq("id", id);
      if (delErr) {
        await mostrarAlerta("Error", delErr.message);
        return;
      }
      await mostrarAlerta("Éxito", "Contenedor eliminado.");
      await refreshAllData();
    });
  });
}

function setupFormCrearCorte() {
  $("form-admin-crear-corte")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const agenciaId = $("corte-agencia-select")?.value;
    const tipo = $("corte-tipo-envio")?.value;
    const numero = $("corte-numero-val")?.value.trim();
    const fecha = $("corte-fecha-val")?.value;

    if (!agenciaId || !tipo || !numero || !fecha) {
      await mostrarAlerta("Atención", "Completa todos los campos.");
      return;
    }

    const { error } = await supabase.from("cortes_contenedores").insert([
      {
        agencia_id: agenciaId,
        tipo_envio: tipo,
        numero_corte: numero,
        fecha_corte: fecha,
        costo_total: 0,
        total_pagado: 0,
        estado: "Pendiente",
        estado_envio: "consolidacion_miami",
      },
    ]);

    if (error) {
      await mostrarAlerta("Error", error.message);
      return;
    }

    e.target.reset();
    await mostrarAlerta("Éxito", "Contenedor creado.");
    await refreshAllData();
  });
}

async function abrirModalGestionBultos(corte) {
  corteActualBultos = corte;
  const ag = agenciasCache.find(
    (a) => String(a.id) === String(corte.agencia_id),
  );
  const tarifa = tarifaPorTipoEnvio(ag, corte.tipo_envio);
  tarifaActualBultos = tarifa;

  if ($("mg-corte-id")) $("mg-corte-id").value = String(corte.id);
  if ($("mg-agencia-id"))
    $("mg-agencia-id").value = String(corte.agencia_id || "");
  if ($("mg-tarifa-valor")) $("mg-tarifa-valor").value = String(tarifa);
  if ($("mg-corte-titulo")) {
    $("mg-corte-titulo").textContent =
      `Bultos · ${(corte.tipo_envio || "").toUpperCase()} · Corte ${corte.numero_corte || ""}`;
  }
  if ($("mg-corte-sub")) {
    $("mg-corte-sub").textContent = `Agencia: ${ag?.nombre || "—"}`;
  }
  if ($("mg-via-envio"))
    $("mg-via-envio").textContent = corte.tipo_envio || "—";
  if ($("mg-tarifa-lb"))
    $("mg-tarifa-lb").textContent = `${formatMoney(tarifa)} / lb`;

  await cargarClientesDeAgenciaEnSelect(corte.agencia_id);
  await cargarBultosDelCorte(corte.id);
  openModal("modal-gestionar-bultos");
}

function sugerirCostoBulto() {
  const peso = parseFloat($("bulto-peso")?.value) || 0;
  const tarifa =
    parseFloat($("mg-tarifa-valor")?.value) || tarifaActualBultos || 0;
  const costo = peso * tarifa;
  if ($("bulto-costo")) $("bulto-costo").value = costo.toFixed(2);
  if ($("bulto-costo-hint")) {
    $("bulto-costo-hint").textContent =
      `${peso.toFixed(2)} lb × ${formatMoney(tarifa)}/lb`;
  }
}

async function recalcularCostoTotalCorte(corteId) {
  const { data: bultos } = await supabase
    .from("paquetes_bultos")
    .select("costo")
    .eq("corte_id", corteId);

  const total = (bultos || []).reduce(
    (s, b) => s + (parseFloat(b.costo) || 0),
    0,
  );

  await supabase
    .from("cortes_contenedores")
    .update({ costo_total: total })
    .eq("id", corteId);

  if ($("mg-total-corte")) $("mg-total-corte").textContent = formatMoney(total);
  if (corteActualBultos && String(corteActualBultos.id) === String(corteId)) {
    corteActualBultos.costo_total = total;
  }
}

async function cargarClientesDeAgenciaEnSelect(agenciaId, seleccionarId = null) {
  const select = $("bulto-cliente-select");
  if (!select) return;
  select.innerHTML = `<option value="">-- Seleccionar cliente --</option>`;
  if (!agenciaId) {
    select.innerHTML = `<option value="">Contenedor sin agencia fija</option>`;
    return;
  }
  const { data: clientes, error } = await supabase
    .from("clientes_agencia")
    .select("*")
    .eq("agencia_id", agenciaId)
    .eq("estado", "activo")
    .order("id", { ascending: true });

  if (error || !clientes || clientes.length === 0) {
    select.innerHTML = `<option value="">No hay clientes activos</option>`;
    return;
  }
  clientes.forEach((cli) => {
    const opt = document.createElement("option");
    opt.value = cli.nombre_cliente || "Cliente";
    opt.textContent = `${cli.nombre_cliente || "Cliente"} (#CLI-${cli.id})`;
    select.appendChild(opt);
    if (seleccionarId !== null && String(cli.id) === String(seleccionarId)) {
      opt.selected = true;
    }
  });
}

function setupRegistroClienteDesdeBultos() {
  const panel = $("panel-bulto-nuevo-cliente");
  const boton = $("btn-bulto-nuevo-cliente");
  const cerrar = () => {
    if (panel) panel.hidden = true;
    boton?.setAttribute("aria-expanded", "false");
  };
  boton?.addEventListener("click", async () => {
    if (!$("mg-agencia-id")?.value) {
      await mostrarAlerta("Atención", "Primero selecciona un contenedor con agencia asignada.");
      return;
    }
    if (!panel) return;
    panel.hidden = !panel.hidden;
    boton.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) $("bcli-nombre")?.focus();
  });
  $("btn-cancelar-bulto-cliente")?.addEventListener("click", () => {
    $("form-bulto-nuevo-cliente")?.reset();
    cerrar();
  });
  $("form-bulto-nuevo-cliente")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const agenciaId = $("mg-agencia-id")?.value;
    const nombre = $("bcli-nombre")?.value.trim();
    const telefono = $("bcli-telefono")?.value.trim();
    if (!agenciaId || !nombre || !telefono) {
      await mostrarAlerta("Atención", "La agencia, el nombre y el teléfono son obligatorios.");
      return;
    }
    const guardar = $("btn-guardar-bulto-cliente");
    if (guardar) guardar.disabled = true;
    try {
      const { data, error } = await supabase.from("clientes_agencia").insert([{
        agencia_id: agenciaId,
        nombre_cliente: nombre,
        telefono,
        departamento: $("bcli-departamento")?.value.trim() || null,
        direccion: $("bcli-direccion")?.value.trim() || null,
        estado: "activo",
      }]).select().single();
      if (error) {
        await mostrarAlerta("Error", "No se pudo registrar el cliente: " + error.message);
        return;
      }
      await cargarClientesDeAgenciaEnSelect(agenciaId, data.id);
      e.target.reset();
      cerrar();
      await mostrarAlerta("Éxito", `Cliente ${nombre} registrado (#CLI-${data.id}). Ya está seleccionado para este bulto.`);
    } finally {
      if (guardar) guardar.disabled = false;
    }
  });
}

function setupFormBultos() {
  setupRegistroClienteDesdeBultos();
  $("bulto-foto-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    const textSpan = $("bulto-foto-filename");
    if (textSpan)
      textSpan.textContent = file ? file.name : "Ningún archivo seleccionado";
  });

  $("bulto-peso")?.addEventListener("input", () => {
    sugerirCostoBulto();
  });

  $("form-agregar-bulto")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const corteId = $("mg-corte-id")?.value;
    const agenciaId = $("mg-agencia-id")?.value;
    const clienteNombre = $("bulto-cliente-select")?.value;
    const tracking = $("bulto-tracking")?.value.trim();
    const peso = parseFloat($("bulto-peso")?.value) || 0;
    let costo = parseFloat($("bulto-costo")?.value);
    const tarifa =
      parseFloat($("mg-tarifa-valor")?.value) || tarifaActualBultos || 0;

    if (!clienteNombre || !tracking) {
      await mostrarAlerta(
        "Atención",
        "Selecciona un cliente e ingresa el tracking.",
      );
      return;
    }
    if (peso <= 0) {
      await mostrarAlerta("Atención", "Ingresa un peso válido en libras.");
      return;
    }

    if (!Number.isFinite(costo) || costo < 0) {
      costo = peso * tarifa;
      if ($("bulto-costo")) $("bulto-costo").value = costo.toFixed(2);
    }

    let fotoBase64 = null;
    const fileInput = $("bulto-foto-input");
    if (fileInput?.files?.[0]) {
      try {
        fotoBase64 = await toBase64(fileInput.files[0]);
      } catch (err) {
        console.error("Error convirtiendo foto:", err);
      }
    }

    const { error } = await supabase.from("paquetes_bultos").insert([
      {
        corte_id: parseInt(corteId, 10) || corteId,
        agencia_id: agenciaId || null,
        cliente_nombre: clienteNombre,
        tracking,
        peso_lbs: peso,
        costo,
        foto_url: fotoBase64,
        estado: "Pendiente",
      },
    ]);

    if (error) {
      await mostrarAlerta(
        "Error",
        "Error al guardar el bulto: " + error.message,
      );
      return;
    }

    $("form-agregar-bulto")?.reset();
    if ($("bulto-foto-filename")) {
      $("bulto-foto-filename").textContent = "Ningún archivo seleccionado";
    }
    if ($("mg-tarifa-valor")) $("mg-tarifa-valor").value = String(tarifa);

    await recalcularCostoTotalCorte(corteId);
    await cargarBultosDelCorte(corteId);
    await cargarCortesGlobalesAdmin();
    await cargarDashboardResumen();
    await mostrarAlerta(
      "Éxito",
      `Bulto guardado. Costo: ${formatMoney(costo)}`,
    );
  });
}

async function cargarBultosDelCorte(corteId) {
  const tbody = $("tabla-gestion-bultos-body");
  if (!tbody) return;

  const { data: bultos, error } = await supabase
    .from("paquetes_bultos")
    .select("*")
    .eq("corte_id", corteId);

  const tarifa =
    parseFloat($("mg-tarifa-valor")?.value) || tarifaActualBultos || 0;

  if (error || !bultos || bultos.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No hay bultos registrados en este contenedor.</td></tr>`;
    if ($("mg-count-bultos")) $("mg-count-bultos").textContent = "0";
    if ($("mg-total-libras")) $("mg-total-libras").textContent = "0.00 lb";
    if ($("mg-total-corte")) $("mg-total-corte").textContent = "$0.00";
    return;
  }

  const total = bultos.reduce((s, b) => s + (parseFloat(b.costo) || 0), 0);
  const totalLbs = bultos.reduce(
    (s, b) => s + (parseFloat(b.peso_lbs) || 0),
    0,
  );
  if ($("mg-count-bultos"))
    $("mg-count-bultos").textContent = String(bultos.length);
  if ($("mg-total-libras"))
    $("mg-total-libras").textContent = `${totalLbs.toFixed(2)} lb`;
  if ($("mg-total-corte")) $("mg-total-corte").textContent = formatMoney(total);

  tbody.innerHTML = "";

  bultos.forEach((b) => {
    const fotoHtml = b.foto_url
      ? `<button type="button" class="thumb btn-ver-foto" data-foto="${escapeHtml(b.foto_url)}">
           <img src="${escapeHtml(b.foto_url)}" alt="Foto" />
         </button>`
      : `<span class="cell-muted">Sin foto</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fotoHtml}</td>
      <td><strong>${escapeHtml(b.tracking || "-")}</strong></td>
      <td>${escapeHtml(b.cliente_nombre || "-")}</td>
      <td>${parseFloat(b.peso_lbs || 0).toFixed(2)} lbs</td>
      <td>${formatMoney(tarifa)}/lb</td>
      <td><strong>${formatMoney(b.costo)}</strong></td>
      <td>
        <button type="button" class="btn-danger btn-sm btn-eliminar-bulto" data-id="${b.id}">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".btn-ver-foto").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-foto");
      const img = $("foto-ampliada");
      if (img && url) {
        img.src = url;
        openModal("modal-foto");
      }
    });
  });

  document.querySelectorAll(".btn-eliminar-bulto").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      const bultoId = ev.currentTarget.getAttribute("data-id");
      const confirmado = await mostrarConfirmacion(
        "Eliminar bulto",
        "¿Eliminar este bulto del contenedor?",
      );
      if (!confirmado) return;

      const { error } = await supabase
        .from("paquetes_bultos")
        .delete()
        .eq("id", bultoId);

      if (error) {
        await mostrarAlerta("Error", "No se pudo eliminar: " + error.message);
        return;
      }

      await recalcularCostoTotalCorte(corteId);
      await cargarBultosDelCorte(corteId);
      await cargarCortesGlobalesAdmin();
      await cargarDashboardResumen();
    });
  });
}

function generarPasswordSegura(longitud = 12) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let pass = "";
  const arr = new Uint32Array(longitud);
  crypto.getRandomValues(arr);
  for (let i = 0; i < longitud; i++) {
    pass += chars[arr[i] % chars.length];
  }
  return pass;
}

function setupPasswordTools() {
  $("toggle-password-btn")?.addEventListener("click", () => {
    const input = $("app-password");
    const btn = $("toggle-password-btn");
    if (!input || !btn) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.setAttribute("aria-pressed", showing ? "false" : "true");
    btn.setAttribute(
      "aria-label",
      showing ? "Mostrar contraseña" : "Ocultar contraseña",
    );
    const use = btn.querySelector("use");
    if (use) use.setAttribute("href", showing ? "#i-eye" : "#i-eye-off");
  });

  $("generate-password-btn")?.addEventListener("click", () => {
    const input = $("app-password");
    if (input) {
      input.type = "text";
      input.value = generarPasswordSegura(12);
    }
  });

  $("copiar-credenciales-btn")?.addEventListener("click", async () => {
    const agencia = $("cred-nombre-agencia")?.textContent || "";
    const usuario = $("cred-usuario")?.textContent || "";
    const password = $("cred-password")?.textContent || "";
    const texto = `Agencia: ${agencia}\nUsuario: ${usuario}\nContraseña: ${password}`;
    try {
      await navigator.clipboard.writeText(texto);
      await mostrarAlerta("Copiado", "Credenciales copiadas al portapapeles.");
    } catch {
      await mostrarAlerta("Aviso", "No se pudo copiar automáticamente.");
    }
  });
}

function resetTarifasFormulario() {
  if ($("app-tarifa-aereo"))
    $("app-tarifa-aereo").value = String(TARIFA_DEFAULT.aereo);
  if ($("app-tarifa-maritimo"))
    $("app-tarifa-maritimo").value = String(TARIFA_DEFAULT.maritimo);
  if ($("app-tarifa-ultra"))
    $("app-tarifa-ultra").value = String(TARIFA_DEFAULT.ultra);
}

// ============================================================
// SOLICITUDES DE SUCURSAL
// ============================================================
async function cargarSolicitudesSucursal() {
  const tbody = $("tabla-solicitudes-sucursal-body");
  const badge = $("badge-sol-sucursal");

  try {
    const { data, error } = await supabase
      .from("solicitudes_sucursal")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    solicitudesSucursalCache = data || [];
    const pendientes = solicitudesSucursalCache.filter(
      (s) => (s.estado || "").toLowerCase() === "pendiente",
    ).length;

    if (badge) {
      if (pendientes > 0) {
        badge.hidden = false;
        badge.textContent = String(pendientes);
      } else {
        badge.hidden = true;
        badge.textContent = "0";
      }
    }

    filtrarYRenderSolicitudesSucursal();
  } catch (err) {
    console.error("Error solicitudes sucursal:", err);
    if (tbody) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Error al cargar: ${escapeHtml(err.message || "")}</td></tr>`;
    }
  }
}

function filtrarYRenderSolicitudesSucursal() {
  const tbody = $("tabla-solicitudes-sucursal-body");
  if (!tbody) return;

  const estadoF = ($("filtro-sol-estado")?.value || "").toLowerCase();
  const tipoF = $("filtro-sol-tipo")?.value || "";
  const q = ($("filtro-sol-buscar")?.value || "").trim().toLowerCase();

  let lista = [...solicitudesSucursalCache];

  if (estadoF) {
    lista = lista.filter((s) => (s.estado || "").toLowerCase() === estadoF);
  }
  if (tipoF) {
    lista = lista.filter((s) => (s.tipo || "") === tipoF);
  }
  if (q) {
    lista = lista.filter((s) => {
      const blob = [
        s.cliente_nombre,
        s.tracking,
        s.agencia_nombre,
        s.agencia_codigo,
        s.detalle,
        s.tipo,
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }

  if (lista.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No hay solicitudes con estos filtros.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  lista.forEach((sol) => {
    const fecha = sol.created_at
      ? new Date(sol.created_at).toLocaleString("es-NI")
      : "—";
    const agenciaTxt = sol.agencia_nombre
      ? `${sol.agencia_nombre}${sol.agencia_codigo ? " · " + sol.agencia_codigo : ""}`
      : sol.agencia_id || "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(fecha)}</td>
      <td>${escapeHtml(agenciaTxt)}</td>
      <td><strong>${escapeHtml(sol.tipo || "—")}</strong></td>
      <td>${escapeHtml(sol.cliente_nombre || "—")}</td>
      <td><code>${escapeHtml(sol.tracking || "—")}</code></td>
      <td>${badgeHtml(sol.estado || "pendiente")}</td>
      <td>
        <button type="button" class="btn-primary btn-sm btn-ver-sol-suc" data-id="${escapeHtml(String(sol.id))}">
          Ver / responder
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btn-ver-sol-suc").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const sol = solicitudesSucursalCache.find(
        (s) => String(s.id) === String(id),
      );
      if (sol) abrirModalSolicitudSucursal(sol);
    });
  });
}

function abrirModalSolicitudSucursal(sol) {
  if ($("sol-suc-id")) $("sol-suc-id").value = String(sol.id);
  if ($("sol-suc-title")) {
    $("sol-suc-title").textContent = sol.tipo || "Solicitud de sucursal";
  }
  if ($("sol-suc-subtitle")) {
    $("sol-suc-subtitle").textContent =
      `ID #${sol.id} · ${sol.estado || "pendiente"}`;
  }
  if ($("sol-suc-agencia")) {
    $("sol-suc-agencia").textContent =
      `${sol.agencia_nombre || "—"} ${sol.agencia_codigo ? "(" + sol.agencia_codigo + ")" : ""}`;
  }
  if ($("sol-suc-tipo")) $("sol-suc-tipo").textContent = sol.tipo || "—";
  if ($("sol-suc-cliente"))
    $("sol-suc-cliente").textContent = sol.cliente_nombre || "—";
  if ($("sol-suc-tracking"))
    $("sol-suc-tracking").textContent = sol.tracking || "—";
  if ($("sol-suc-detalle"))
    $("sol-suc-detalle").textContent = sol.detalle || "—";
  if ($("sol-suc-fecha")) {
    $("sol-suc-fecha").textContent = sol.created_at
      ? new Date(sol.created_at).toLocaleString("es-NI")
      : "—";
  }
  if ($("sol-suc-estado-actual")) {
    $("sol-suc-estado-actual").innerHTML = badgeHtml(sol.estado || "pendiente");
  }
  if ($("sol-suc-nuevo-estado")) {
    $("sol-suc-nuevo-estado").value = sol.estado || "pendiente";
  }
  if ($("sol-suc-respuesta")) {
    $("sol-suc-respuesta").value = sol.respuesta_admin || "";
  }

  const metaBox = $("sol-suc-meta-box");
  const metaEl = $("sol-suc-meta");
  if (metaBox && metaEl) {
    if (
      sol.meta &&
      typeof sol.meta === "object" &&
      Object.keys(sol.meta).length
    ) {
      metaBox.hidden = false;
      metaEl.textContent = JSON.stringify(sol.meta, null, 2);
    } else {
      metaBox.hidden = true;
      metaEl.textContent = "";
    }
  }

  const imgWrap = $("sol-suc-imagen-actual");
  const imgLink = $("sol-suc-imagen-link");
  if (imgWrap && imgLink) {
    if (sol.imagen_url) {
      imgWrap.hidden = false;
      imgLink.href = sol.imagen_url;
    } else {
      imgWrap.hidden = true;
      imgLink.href = "#";
    }
  }

  if ($("sol-suc-foto-input")) $("sol-suc-foto-input").value = "";
  if ($("sol-suc-foto-filename")) {
    $("sol-suc-foto-filename").textContent = "Ningún archivo seleccionado";
  }

  openModal("modal-responder-sol-sucursal");
}

async function subirEvidenciaSolicitud(file, solicitudId) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  if (!["png", "jpg", "jpeg", "webp"].includes(ext)) {
    return { url: null, error: "Formato no permitido (PNG, JPG, WEBP)." };
  }
  if (file.size > MAX_EVIDENCIA_BYTES) {
    return { url: null, error: "La imagen supera 3 MB." };
  }

  const nombre = `sol_${solicitudId}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET_EVIDENCIAS)
    .upload(nombre, file, { contentType: file.type, upsert: true });

  if (error) {
    return { url: null, error: error.message || "Error al subir evidencia" };
  }

  const { data } = supabase.storage
    .from(BUCKET_EVIDENCIAS)
    .getPublicUrl(nombre);
  return { url: data?.publicUrl || null, error: null };
}

function setupSolicitudesSucursal() {
  $("filtro-sol-estado")?.addEventListener(
    "change",
    filtrarYRenderSolicitudesSucursal,
  );
  $("filtro-sol-tipo")?.addEventListener(
    "change",
    filtrarYRenderSolicitudesSucursal,
  );
  $("filtro-sol-buscar")?.addEventListener("input", () => {
    filtrarYRenderSolicitudesSucursal();
  });

  $("sol-suc-foto-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    const span = $("sol-suc-foto-filename");
    if (span)
      span.textContent = file ? file.name : "Ningún archivo seleccionado";
  });

  $("form-responder-sol-sucursal")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("sol-suc-id")?.value;
    const estado = $("sol-suc-nuevo-estado")?.value || "pendiente";
    const respuesta = ($("sol-suc-respuesta")?.value || "").trim();
    const file = $("sol-suc-foto-input")?.files?.[0];
    const btn = $("btn-guardar-sol-suc");

    if (!id) {
      await mostrarAlerta("Error", "Solicitud no identificada.");
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Guardando...";
    }

    try {
      let imagenUrl = null;
      if (file) {
        const up = await subirEvidenciaSolicitud(file, id);
        if (up.error) {
          await mostrarAlerta("Error", up.error);
          return;
        }
        imagenUrl = up.url;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const respondidoPor = session?.user?.email || "admin";

      const payload = {
        estado,
        respuesta_admin: respuesta || null,
        respondido_por: respondidoPor,
        respondido_at: new Date().toISOString(),
      };
      if (imagenUrl) payload.imagen_url = imagenUrl;

      const { error } = await supabase
        .from("solicitudes_sucursal")
        .update(payload)
        .eq("id", id);

      if (error) throw error;

      closeModal("modal-responder-sol-sucursal");
      await mostrarAlerta(
        "Éxito",
        "Respuesta guardada. La agencia verá el estado actualizado.",
      );
      await cargarSolicitudesSucursal();
      await cargarDashboardResumen();
    } catch (err) {
      console.error(err);
      await mostrarAlerta("Error", err.message || "No se pudo guardar.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Guardar respuesta";
      }
    }
  });
}

// ============================================================
// SOLICITUDES DE AFILIACIÓN
// ============================================================
async function loadSolicitudesPendientes() {
  const tbody = $("solicitudes-table-body");
  if (!tbody) return;

  const approvalModal = $("approval-modal");
  const approvalForm = $("approval-form");
  const rejectModal = $("reject-modal");
  const rejectForm = $("reject-form");

  try {
    const { data: pendientes, error } = await supabase
      .from("solicitudes_afiliacion")
      .select("*")
      .eq("estado", "pendiente");

    if (error) throw error;

    tbody.innerHTML = "";

    if (!pendientes || pendientes.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No hay solicitudes pendientes.</td></tr>`;
      return;
    }

    pendientes.forEach((sol) => {
      const negocio = escapeHtml(safeText(sol.nombre_negocio, "Sin negocio"));
      const contacto = escapeHtml(
        safeText(sol.nombre_contacto || sol.contacto, "Sin nombre"),
      );
      const correo = escapeHtml(safeText(sol.correo, "Sin correo"));
      const telefono = escapeHtml(safeText(sol.telefono || sol.celular, ""));
      const direccion = escapeHtml(safeText(sol.direccion, ""));
      const departamento = escapeHtml(safeText(sol.departamento, "N/D"));
      const referencia = escapeHtml(safeText(sol.codigo_referencia, "-"));

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${negocio}</strong></td>
        <td>${contacto}</td>
        <td>${correo}</td>
        <td>${departamento}</td>
        <td>${referencia}</td>
        <td>
          <div class="actions-cell">
            <button type="button" class="btn-primary btn-sm btn-abrir-modal"
              data-id="${escapeHtml(sol.id)}"
              data-negocio="${escapeHtml(safeText(sol.nombre_negocio, ""))}"
              data-contacto="${contacto}"
              data-telefono="${telefono}"
              data-direccion="${direccion}"
              data-departamento="${departamento}"
              data-correo="${correo}">
              Aprobar
            </button>
            <button type="button" class="btn-danger btn-sm btn-abrir-reject"
              data-id="${escapeHtml(sol.id)}"
              data-negocio="${escapeHtml(safeText(sol.nombre_negocio, ""))}">
              Rechazar
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll(".btn-abrir-modal").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const t = e.currentTarget;
        const negocio = t.getAttribute("data-negocio") || "";
        const correo = t.getAttribute("data-correo") || "";
        const contacto = t.getAttribute("data-contacto") || "";
        const telefono = t.getAttribute("data-telefono") || "";
        const direccion = t.getAttribute("data-direccion") || "";
        const departamento = t.getAttribute("data-departamento") || "";

        if ($("app-solicitud-id"))
          $("app-solicitud-id").value = t.getAttribute("data-id");
        if ($("app-nombre-agencia")) $("app-nombre-agencia").value = negocio;
        if ($("app-contacto"))
          $("app-contacto").value = contacto !== "Sin nombre" ? contacto : "";
        if ($("app-correo"))
          $("app-correo").value = correo !== "Sin correo" ? correo : "";
        if ($("app-telefono")) $("app-telefono").value = telefono;
        if ($("app-direccion")) $("app-direccion").value = direccion;
        if ($("app-departamento")) {
          $("app-departamento").value =
            departamento && departamento !== "N/D" ? departamento : "";
        }
        if ($("app-codigo")) $("app-codigo").value = "";
        if ($("app-password")) $("app-password").value = "";
        resetTarifasFormulario();

        const subtitle = $("modal-subtitle");
        if (subtitle)
          subtitle.textContent = `Configurando acceso para: ${negocio}`;

        show(approvalModal);
      });
    });

    document.querySelectorAll(".btn-abrir-reject").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const t = e.currentTarget;
        const negocio = t.getAttribute("data-negocio") || "";
        if ($("rej-solicitud-id"))
          $("rej-solicitud-id").value = t.getAttribute("data-id");
        if ($("reject-modal-subtitle")) {
          $("reject-modal-subtitle").textContent = `Solicitud de: ${negocio}`;
        }
        if ($("rej-motivo")) $("rej-motivo").value = "";
        show(rejectModal);
      });
    });

    if (approvalForm) {
      approvalForm.onsubmit = async (e) => {
        e.preventDefault();

        const solId = $("app-solicitud-id")?.value;
        const codigo = $("app-codigo")?.value.trim();
        const nombreAgencia = $("app-nombre-agencia")?.value.trim();
        const contacto = $("app-contacto")?.value.trim();
        const correoSolicitante = $("app-correo")?.value.trim();
        const telefono = $("app-telefono")?.value.trim();
        const direccion = $("app-direccion")?.value.trim();
        const departamento = $("app-departamento")?.value.trim() || null;
        const passwordTemporal = $("app-password")?.value.trim();
        const tarifaAereo = parseTarifa(
          $("app-tarifa-aereo")?.value,
          TARIFA_DEFAULT.aereo,
        );
        const tarifaMaritimo = parseTarifa(
          $("app-tarifa-maritimo")?.value,
          TARIFA_DEFAULT.maritimo,
        );
        const tarifaUltra = parseTarifa(
          $("app-tarifa-ultra")?.value,
          TARIFA_DEFAULT.ultra,
        );
        const logoFileInput = $("app-logo-file");
        const btn = $("confirm-approval-btn");

        if (
          !solId ||
          !codigo ||
          !nombreAgencia ||
          !contacto ||
          !correoSolicitante ||
          !telefono ||
          !passwordTemporal
        ) {
          await mostrarAlerta(
            "Atención",
            "Completa todos los campos obligatorios.",
          );
          return;
        }
        if (passwordTemporal.length < 8) {
          await mostrarAlerta(
            "Atención",
            "La contraseña debe tener al menos 8 caracteres.",
          );
          return;
        }

        if (btn) {
          btn.textContent = "Procesando...";
          btn.disabled = true;
        }

        try {
          let logoUrl = null;
          let avisoLogo = "";

          if (logoFileInput?.files?.length > 0) {
            const resultado = await subirLogo(logoFileInput.files[0], codigo);
            logoUrl = resultado.url;
            if (resultado.aviso) avisoLogo = resultado.aviso;
          }

          await invocarAfiliaciones({
            accion: "aprobar",
            solicitud_id: solId,
            codigo,
            nombre_agencia: nombreAgencia,
            password: passwordTemporal,
            logo_url: logoUrl,
          });

          const updatePayload = {
            contacto,
            nombre_contacto: contacto,
            telefono,
            celular: telefono,
            direccion: direccion || null,
            departamento: departamento || null,
            correo: correoSolicitante,
            password_temporal: passwordTemporal,
            tarifa_aereo: tarifaAereo,
            tarifa_maritimo: tarifaMaritimo,
            tarifa_ultra: tarifaUltra,
          };
          if (logoUrl) updatePayload.logo_url = logoUrl;

          const { ok, error: upErr } = await actualizarAgenciaPostAprobacion(
            codigo,
            updatePayload,
          );

          let avisoExtra = "";
          if (avisoLogo) avisoExtra += avisoLogo;
          if (!ok && upErr) {
            console.error("No se guardaron todos los datos extra:", upErr);
            avisoExtra +=
              (avisoExtra ? " " : "") +
              "Algunos datos (departamento/tarifas) no se guardaron.";
          }

          hide(approvalModal);
          approvalForm.reset();
          resetTarifasFormulario();
          if ($("file-chosen"))
            $("file-chosen").textContent = "Ningún archivo seleccionado";

          if ($("cred-nombre-agencia"))
            $("cred-nombre-agencia").textContent = nombreAgencia;
          if ($("cred-usuario"))
            $("cred-usuario").textContent = correoSolicitante;
          if ($("cred-password"))
            $("cred-password").textContent = passwordTemporal;
          if ($("cred-aviso")) {
            $("cred-aviso").textContent =
              `Tarifas: Aéreo ${formatMoney(tarifaAereo)}/lb · Marítimo ${formatMoney(tarifaMaritimo)}/lb · Ultra ${formatMoney(tarifaUltra)}/lb` +
              (avisoExtra ? ` · ${avisoExtra}` : "");
          }

          openModal("modal-credenciales");
          await refreshAllData();
        } catch (err) {
          console.error("Error al aprobar:", err);
          await mostrarAlerta(
            "Error",
            `Error al aprobar: ${err.message || err}`,
          );
        } finally {
          if (btn) {
            btn.textContent = "Crear agencia y aprobar";
            btn.disabled = false;
          }
        }
      };
    }

    if (rejectForm) {
      rejectForm.onsubmit = async (e) => {
        e.preventDefault();
        const solId = $("rej-solicitud-id")?.value;
        const motivo = $("rej-motivo")?.value.trim();
        const btn = $("confirm-reject-btn");

        if (!solId || !motivo) {
          await mostrarAlerta("Atención", "Ingresa un motivo de rechazo.");
          return;
        }

        if (btn) {
          btn.textContent = "Guardando...";
          btn.disabled = true;
        }

        try {
          await invocarAfiliaciones({
            accion: "rechazar",
            solicitud_id: solId,
            motivo,
          });
          await mostrarAlerta("Éxito", "Solicitud rechazada correctamente.");
          hide(rejectModal);
          rejectForm.reset();
          await refreshAllData();
        } catch (err) {
          console.error("Error al rechazar:", err);
          await mostrarAlerta(
            "Error",
            `Error al rechazar: ${err.message || err}`,
          );
        } finally {
          if (btn) {
            btn.textContent = "Confirmar rechazo";
            btn.disabled = false;
          }
        }
      };
    }
  } catch (err) {
    console.error("Error cargando solicitudes:", err);
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">Error al cargar solicitudes.</td></tr>`;
  }
}


// REPORTES OPERATIVOS: solo lectura, para Superadmin y Operador.
const REP_TARIFA_PEQUENO = 0.20;
const REP_TARIFA_GRANDE = 1.00;
let repUltimasFilas = [];
let repPreparado = false;
function repNormalizar(s) { return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function repDinero(n) { return "$" + n.toFixed(2); }
function repTexto(s) { return String(s ?? "").replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function repModalidad(tipo) { const t=repNormalizar(tipo); return t.includes('aer') ? 'aereo' : t.includes('mar') ? 'mar' : t; }
async function repLeerTodo(tabla, campos) {
  const filas=[];
  for(let inicio=0; inicio<100000; inicio+=1000) {
    const {data,error}=await supabase.from(tabla).select(campos).range(inicio,inicio+999);
    if(error) throw error;
    filas.push(...(data||[]));
    if(!data || data.length<1000) return filas;
  }
  throw new Error('Se superó el límite de 100,000 registros. Aplicá filtros más específicos.');
}
async function prepararReportesOperativos() {
  if(repPreparado) return;
  repPreparado=true;
  try {
    const agencias=await repLeerTodo('agencias','id,nombre');
    const selector=$('rep-agencia');
    agencias.sort((a,b)=>String(a.nombre||'').localeCompare(String(b.nombre||''),'es'));
    agencias.forEach(a=>{ const o=document.createElement('option');o.value=a.id;o.textContent=a.nombre||a.id;selector.appendChild(o); });
  } catch(e) {
    repPreparado=false;
    $('rep-estado').textContent='No se pudieron cargar las agencias: '+e.message;
  }
}
function setupReportesOperativos() {
  $('rep-consultar')?.addEventListener('click', generarReporteOperativo);
  $('rep-csv')?.addEventListener('click', descargarReporteOperativoCSV);
  $('rep-busqueda')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();generarReporteOperativo();}});
}
async function generarReporteOperativo() {
  const boton=$('rep-consultar'), estado=$('rep-estado');
  boton.disabled=true;
  $('rep-csv').disabled=true;
  estado.textContent='Consultando cortes y paquetes...';
  try {
    const [agencias,cortes]=await Promise.all([
      repLeerTodo('agencias','id,nombre'),
      repLeerTodo('cortes_contenedores','id,agencia_id,tipo_envio,numero_corte')
    ]);
    const nombres=new Map(agencias.map(a=>[String(a.id),a.nombre||'—']));
    const q=repNormalizar($('rep-busqueda').value.trim());
    const agencia=$('rep-agencia').value;
    const modalidad=$('rep-modalidad').value;
    const seleccion=cortes.filter(c=>{
      const nombre=nombres.get(String(c.agencia_id))||'';
      const coincide=!q||repNormalizar([nombre,c.numero_corte,c.tipo_envio].join(' ')).includes(q);
      return coincide && (!agencia||String(c.agencia_id)===agencia) && (!modalidad||repModalidad(c.tipo_envio)===modalidad);
    });
    // Se consultan paquetes en lotes de cortes, evitando cargar paquetes de otros cortes.
    const mapa=new Map(seleccion.map(c=>[String(c.id),{agencia:nombres.get(String(c.agencia_id))||'—',corte:c.numero_corte||'—',tipo:c.tipo_envio||'—',pequenos:0,grandes:0}]));
    const ids=seleccion.map(c=>c.id);
    for(let k=0;k<ids.length;k+=50) {
      const grupo=ids.slice(k,k+50);
      for(let offset=0;offset<100000;offset+=1000) {
        const {data,error}=await supabase.from('paquetes_bultos').select('corte_id,peso_lbs').in('corte_id',grupo).range(offset,offset+999);
        if(error) throw error;
        for(const b of data||[]) {
          const fila=mapa.get(String(b.corte_id));
          if(!fila) continue;
          const peso=Number(b.peso_lbs);
          if(!Number.isFinite(peso)||peso<0) continue;
          if(peso>=20) fila.grandes++; else fila.pequenos++;
        }
        if(!data||data.length<1000) break;
        if(offset>=99000) throw new Error('Demasiados paquetes en la consulta; acotá los filtros.');
      }
    }
    repUltimasFilas=[...mapa.values()].map(f=>({...f,total:f.pequenos+f.grandes,pago:f.pequenos*REP_TARIFA_PEQUENO+f.grandes*REP_TARIFA_GRANDE}));
    repUltimasFilas.sort((a,b)=>a.agencia.localeCompare(b.agencia,'es')||String(a.corte).localeCompare(String(b.corte),'es'));
    const totalP=repUltimasFilas.reduce((n,f)=>n+f.pequenos,0);
    const totalG=repUltimasFilas.reduce((n,f)=>n+f.grandes,0);
    $('rep-pequenos').textContent=totalP;
    $('rep-grandes').textContent=totalG;
    $('rep-total').textContent=totalP+totalG;
    $('rep-pago').textContent=repDinero(totalP*.20+totalG);
    $('rep-filas').innerHTML=repUltimasFilas.length ? repUltimasFilas.map(f=>`<tr><td>${repTexto(f.agencia)}</td><td>${repTexto(f.corte)}</td><td>${repTexto(f.tipo)}</td><td>${f.pequenos}</td><td>${f.grandes}</td><td>${f.total}</td><td>${repDinero(f.pago)}</td></tr>`).join('') : '<tr><td colspan="7">No hay cortes que coincidan con los filtros.</td></tr>';
    estado.textContent=`Reporte generado: ${seleccion.length} corte(s), ${totalP+totalG} paquete(s). Paquetes sin peso válido no se contabilizan.`;
    $('rep-csv').disabled=repUltimasFilas.length===0;
  } catch(e) {
    console.error('Error reporte operativo',e);
    estado.textContent='No se pudo generar el reporte: '+e.message;
    repUltimasFilas=[];
  } finally {boton.disabled=false;}
}
function descargarReporteOperativoCSV() {
  if(!repUltimasFilas.length)return;
  const filas=[['Agencia','Corte','Modalidad','Menores de 20 lb','Desde 20 lb','Total paquetes','Pago USD'],...repUltimasFilas.map(f=>[f.agencia,f.corte,f.tipo,f.pequenos,f.grandes,f.total,f.pago.toFixed(2)])];
  const csv='\uFEFF'+filas.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  const a=document.createElement('a');a.href=url;a.download='BioMax_Reporte_Operativo.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// LIQUIDACIÓN DE CARGA V2 — vista previa sin escritura en Supabase.
let liqGuias = [{id:1, numero:'', peso:'', transportista:'', entrega:'', estado:'Acta pendiente', condicion:'Contado', cortes:[]}];
let liqSiguienteId=2, liqCatalogo=[], liqAgencias=new Map(), liqFilas=[], liqResumen=[], liqCargado=false, liqValido=false, liqTotales={};
const liqN=(n)=>Number(n).toFixed(2);
const liqUSD=(n)=>'$'+liqN(n);
function liqInvalidar(){liqValido=false;$('liq-resultados').hidden=true;$('liq-aprobar').checked=false;['liq-pdf','liq-png','liq-csv'].forEach(id=>$(id).disabled=true);}
function liqOpciones(cortes){return cortes.map(c=>`<option value="${repTexto(c.id)}">${repTexto((liqAgencias.get(String(c.agencia_id))?.nombre||'Agencia')+' · '+(c.tipo_envio||'')+' · '+(c.numero_corte||''))}</option>`).join('');}
function liqPintar(){
  const cont=$('liq-guias');if(!cont)return;
  cont.innerHTML=liqGuias.map((g,i)=>`<div class="stat-card" style="border:1px solid #dce2ed;padding:14px">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><strong>Guía ${i+1}</strong><button type="button" class="btn-secondary" data-liq-quitar="${g.id}" ${liqGuias.length===1?'disabled':''}>Quitar</button></div>
    <div class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:12px">
      <div class="form-field"><label class="form-label">Número de guía</label><input class="form-input" data-liq-id="${g.id}" data-liq-campo="numero" value="${repTexto(g.numero)}" placeholder="Ej. REI-51374" /></div>
      <div class="form-field"><label class="form-label">Peso total de la guía (lbs)</label><input class="form-input" data-liq-id="${g.id}" data-liq-campo="peso" type="number" step="0.01" min="0" value="${repTexto(g.peso)}" placeholder="Ej. 100.00" /></div>
    </div>
    <div class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:10px">
      <div class="form-field"><label class="form-label">Transportista</label><select class="form-input" data-liq-id="${g.id}" data-liq-campo="transportista"><option value="">Seleccioná un transportista</option>${["Redex","AeroMar","Voladito","Rapidus","UltraBox"].map(t=>`<option value="${t}" ${g.transportista===t?"selected":""}>${t}</option>`).join("")}</select></div>
      <div class="form-field"><label class="form-label">Entrega estimada</label><input class="form-input" data-liq-id="${g.id}" data-liq-campo="entrega" value="${repTexto(g.entrega||'')}" placeholder="Ej. 16/11/2026" /></div>
      <div class="form-field"><label class="form-label">Estado</label><input class="form-input" data-liq-id="${g.id}" data-liq-campo="estado" value="${repTexto(g.estado||'')}" /></div>
      <div class="form-field"><label class="form-label">Condición</label><input class="form-input" data-liq-id="${g.id}" data-liq-campo="condicion" value="${repTexto(g.condicion||'')}" /></div>
    </div>
    <div class="form-field" style="margin-top:12px"><label class="form-label">Cortes incluidos en esta guía (Ctrl o Cmd para seleccionar varios)</label><select class="form-input" multiple size="${Math.min(7,Math.max(3,liqCatalogo.length))}" data-liq-id="${g.id}" data-liq-campo="cortes" style="min-height:110px">${liqOpciones(liqCatalogo)}</select></div>
    <p class="card-desc" style="margin-top:6px">Un corte solo puede asignarse a una guía en esta versión de prueba.</p>
  </div>`).join('');
  cont.querySelectorAll('select[data-liq-campo="cortes"]').forEach(sel=>{const g=liqGuias.find(g=>String(g.id)===sel.dataset.liqId);[...sel.options].forEach(o=>o.selected=g.cortes.includes(o.value));});
}
async function prepararLiquidacion(){
  if(liqCargado)return;
  $('liq-estado').textContent='Cargando cortes y tarifas...';
  try{
    const [cortes,agencias]=await Promise.all([repLeerTodo('cortes_contenedores','id,agencia_id,tipo_envio,numero_corte'),repLeerTodo('agencias','id,nombre,tarifa_aereo,tarifa_maritimo,tarifa_ultra,agencia_maestra')]);
    liqAgencias=new Map(agencias.map(a=>[String(a.id),a]));
    liqCatalogo=cortes.sort((a,b)=>String(b.numero_corte||'').localeCompare(String(a.numero_corte||'')));
    liqCargado=true;liqPintar();liqPintarMaestras();$('liq-estado').textContent=`${cortes.length} cortes disponibles. Ingresá una guía y seleccioná sus cortes.`;
  }catch(e){$('liq-estado').textContent='No se pudieron cargar los cortes: '+e.message;}
}
function liqPintarMaestras(){
  const el=$('liq-config-maestras');if(!el)return;
  el.innerHTML=[...liqAgencias.values()].sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es')).map(a=>`<label style="display:flex;align-items:center;gap:10px;justify-content:space-between;margin:6px 0"><span>${repTexto(a.nombre)}</span><select class="form-input" style="max-width:210px" data-maestra-id="${repTexto(a.id)}"><option value="">Sin asignar</option><option value="BIO" ${a.agencia_maestra==='BIO'?'selected':''}>BIO</option><option value="MML" ${a.agencia_maestra==='MML'?'selected':''}>MML</option></select></label>`).join('');
}
async function liqGuardarMaestra(e){const sel=e.target.closest('[data-maestra-id]');if(!sel)return;const a=liqAgencias.get(sel.dataset.maestraId);if(!a)return;const anterior=a.agencia_maestra;sel.disabled=true;const {error}=await supabase.from('agencias').update({agencia_maestra:sel.value||null}).eq('id',a.id);sel.disabled=false;if(error){sel.value=anterior||'';alert('No se pudo guardar la agencia maestra: '+error.message);return;}a.agencia_maestra=sel.value||null;liqInvalidar();$('liq-estado').textContent='Asignación guardada en Supabase. Volvé a calcular la liquidación para aplicar los cambios.';}
function setupLiquidacion(){
  $('liq-config-maestras')?.addEventListener('change',liqGuardarMaestra);
  $('liq-agregar')?.addEventListener('click',()=>{liqGuias.push({id:liqSiguienteId++,numero:'',peso:'',transportista:'',entrega:'',estado:'Acta pendiente',condicion:'Contado',cortes:[]});liqInvalidar();liqPintar();});
  $('liq-guias')?.addEventListener('click',e=>{const b=e.target.closest('[data-liq-quitar]');if(!b)return;liqGuias=liqGuias.filter(g=>String(g.id)!==b.dataset.liqQuitar);liqInvalidar();liqPintar();});
  const cambiar=e=>{const el=e.target;if(!el.dataset.liqCampo)return;const g=liqGuias.find(g=>String(g.id)===el.dataset.liqId);if(!g)return;g[el.dataset.liqCampo]=el.dataset.liqCampo==='cortes'?[...el.selectedOptions].map(o=>o.value):el.value;liqInvalidar();};
  $('liq-guias')?.addEventListener('input',cambiar);$('liq-guias')?.addEventListener('change',cambiar);
  $('liq-generar')?.addEventListener('click',liqCalcular);
  $('liq-aprobar')?.addEventListener('change',()=>{const ok=liqValido&&$('liq-aprobar').checked;['liq-pdf','liq-png','liq-csv'].forEach(id=>$(id).disabled=!ok);$('liq-aviso').textContent=ok?'Prorrateo autorizado para esta vista previa. No se ha guardado en la base de datos.':'Autorizá la vista previa para habilitar exportaciones. No se guardará en Supabase.';});
  $('liq-csv')?.addEventListener('click',liqCSV);$('liq-pdf')?.addEventListener('click',liqPDF);$('liq-png')?.addEventListener('click',liqPNG);
}
async function liqCalcular(){
  const btn=$('liq-generar');btn.disabled=true;liqInvalidar();$('liq-estado').textContent='Calculando pesos, tarifas y prorrateos...';
  try{
    if(!liqCargado)await prepararLiquidacion();if(!liqCargado)throw Error('No se pudo cargar el catálogo.');
    const usados=new Set();
    for(const g of liqGuias){
      if(!g.numero.trim())throw Error('Ingresá el número de cada guía.');
      if(g.peso===''||!Number.isFinite(Number(g.peso))||Number(g.peso)<0)throw Error('Ingresá un peso válido para cada guía.');
      if(!g.cortes.length)throw Error('Seleccioná al menos un corte por guía.');
      for(const id of g.cortes){if(usados.has(id))throw Error('Un mismo corte está seleccionado en más de una guía. Revisá la asignación.');usados.add(id);}
    }
    const ids=[...usados],pesos=new Map(ids.map(id=>[id,{peso:0,paquetes:0}]));
    for(let k=0;k<ids.length;k+=50){const grupo=ids.slice(k,k+50);for(let off=0;off<100000;off+=1000){
      const {data,error}=await supabase.from('paquetes_bultos').select('corte_id,peso_lbs').in('corte_id',grupo).range(off,off+999);
      if(error)throw error;
      for(const p of data||[]){const r=pesos.get(String(p.corte_id));if(!r)continue;const n=Number(p.peso_lbs);if(p.peso_lbs===null||p.peso_lbs===''||!Number.isFinite(n)||n<0)throw Error('Hay paquetes con peso inválido. Revisá los registros antes de liquidar.');r.peso+=n;r.paquetes++;}
      if(!data||data.length<1000)break;if(off>=99000)throw Error('Demasiados paquetes para consultar.');
    }}
    const filas=[];let pesoGuia=0,pesoSistema=0,adicionalTotal=0,costoAduanaTotal=0;const detallesGuias=[];
    for(const g of liqGuias){
      const seleccion=g.cortes.map(id=>liqCatalogo.find(c=>String(c.id)===id));if(seleccion.some(c=>!c))throw Error('Un corte seleccionado ya no está disponible.');
      const base=seleccion.reduce((n,c)=>n+pesos.get(String(c.id)).peso,0),guia=Number(g.peso),dif=guia-base;
      if(base<=0)throw Error(`La guía ${g.numero} no tiene peso válido para prorratear.`);
      if(dif< -0.005)throw Error(`La guía ${g.numero} pesa menos que los paquetes registrados (${liqN(dif)} lbs). Revisá los datos; no se aplican ajustes negativos automáticamente.`);
      const modalidades=[...new Set(seleccion.map(c=>repModalidad(c.tipo_envio)))];if(modalidades.length!==1||!['aereo','mar'].includes(modalidades[0]))throw Error(`La guía ${g.numero} debe contener cortes de una sola modalidad (Aéreo o Marítimo).`);const tarifaAduana=modalidades[0]==='mar'?1.50:4.50;const costoGuia=Math.round(guia*tarifaAduana*100)/100;detallesGuias.push({numero:g.numero,transportista:g.transportista||'—',entrega:g.entrega||'—',estado:g.estado||'—',condicion:g.condicion||'—',cortes:[...new Set(seleccion.map(c=>c.numero_corte))].join(', '),modalidad:modalidades[0]==='mar'?'Marítimo':'Aéreo',pesoGuia:guia,pesoSistema:base,diferencia:dif,tarifaAduana,costoAduana:costoGuia});costoAduanaTotal+=costoGuia;
      pesoGuia+=guia;pesoSistema+=base;adicionalTotal+=Math.max(0,dif);
      // Cálculo a centésimas: repartir por proporción, con remanente por restos mayores.
      const extraCent=Math.round(Math.max(0,dif)*100);
      const cuotas=seleccion.map(c=>{const raw=extraCent*pesos.get(String(c.id)).peso/base;return {id:String(c.id),cent:Math.floor(raw),resto:raw-Math.floor(raw)};});
      let sobrante=extraCent-cuotas.reduce((n,x)=>n+x.cent,0);
      [...cuotas].sort((a,b)=>b.resto-a.resto).slice(0,sobrante).forEach(x=>x.cent++);
      const cuotasMap=new Map(cuotas.map(x=>[x.id,x.cent/100]));
      for(const c of seleccion){const p=pesos.get(String(c.id)),ag=liqAgencias.get(String(c.agencia_id)),tarifa=tarifaPorTipoEnvio(ag,c.tipo_envio),extra=cuotasMap.get(String(c.id));
        if(!ag?.agencia_maestra)throw Error(`La agencia ${ag?.nombre||'desconocida'} no tiene agencia maestra asignada. Configurala antes de liquidar.`);const costoAduana=Math.round((p.peso+extra)*tarifaAduana*100)/100;const total=Math.round((p.peso+extra)*tarifa*100)/100;filas.push({guia:g.numero,corte:c.numero_corte||'—',modalidad:c.tipo_envio||'—',agencia:ag.nombre,maestra:ag.agencia_maestra,paquetes:p.paquetes,peso:p.peso,extra,final:p.peso+extra,tarifa,tarifaAduana,costoAduana,total,margen:Math.round((total-costoAduana)*100)/100});
      }
    }
    const prioridad=m=>m==='BIO'?0:m==='MML'?1:2;
    filas.sort((a,b)=>prioridad(a.maestra)-prioridad(b.maestra)||a.agencia.localeCompare(b.agencia,'es')||a.guia.localeCompare(b.guia,'es'));
    const resumen=new Map();for(const f of filas){const k=f.maestra+'|'+f.agencia;const a=resumen.get(k)||{agencia:f.agencia,maestra:f.maestra,paquetes:0,peso:0,extra:0,final:0,costoAduana:0,total:0,margen:0};for(const k of ['paquetes','peso','extra','final','costoAduana','total','margen'])a[k]+=f[k];resumen.set(k,a);}
    liqFilas=filas;liqResumen=[...resumen.values()].sort((a,b)=>prioridad(a.maestra)-prioridad(b.maestra)||a.agencia.localeCompare(b.agencia,'es'));
    const cobroTotal=Math.round(filas.reduce((n,f)=>n+f.total,0)*100)/100;
    liqTotales={pesoGuia,pesoSistema,diferencia:pesoGuia-pesoSistema,costoAduanaTotal,cobroTotal,ganancia:Math.round((cobroTotal-costoAduanaTotal)*100)/100,guias:detallesGuias};
    $('liq-peso-guia').textContent=liqN(pesoGuia)+' lbs';$('liq-peso-sistema').textContent=liqN(pesoSistema)+' lbs';$('liq-diferencia').textContent=liqN(pesoGuia-pesoSistema)+' lbs';$('liq-total').textContent=liqUSD(cobroTotal);
    $('liq-costo-aduana').textContent=liqUSD(costoAduanaTotal);$('liq-ganancia').textContent=liqUSD(liqTotales.ganancia);
    $('liq-filas').innerHTML=filas.map(f=>`<tr><td>${repTexto(f.guia)}</td><td>${repTexto(f.corte)}</td><td>${repTexto(f.modalidad)}</td><td>${repTexto(f.agencia)}</td><td>${repTexto(f.maestra)}</td><td>${f.paquetes}</td><td>${liqN(f.peso)}</td><td>+${liqN(f.extra)}</td><td>${liqN(f.final)}</td><td>${liqUSD(f.tarifaAduana)}</td><td>${liqUSD(f.costoAduana)}</td><td>${liqUSD(f.tarifa)}</td><td>${liqUSD(f.total)}</td><td>${liqUSD(f.margen)}</td></tr>`).join('');
    $('liq-resumen').innerHTML=liqResumen.map(f=>`<tr><td>${repTexto(f.maestra)}</td><td>${repTexto(f.agencia)}</td><td>${f.paquetes}</td><td>${liqN(f.final)}</td><td>${liqUSD(f.costoAduana)}</td><td>${liqUSD(f.total)}</td><td>${liqUSD(f.margen)}</td></tr>`).join('');
    const maestras=['BIO','MML'];$('liq-maestras').innerHTML=maestras.map(m=>`<tr><td><strong>${m==='BIO'?'Bring It On (BIO)':'MarMax Logistics (MML)'}</strong></td><td><strong>${liqUSD(filas.filter(f=>f.maestra===m).reduce((n,f)=>n+f.total,0))}</strong></td></tr>`).join('');
    $('liq-guias-resumen').innerHTML=detallesGuias.map(g=>`<tr><td>${repTexto(g.numero)}</td><td>${repTexto(g.transportista)}</td><td>${repTexto(g.cortes)}</td><td>${repTexto(g.modalidad)}</td><td>${repTexto(g.entrega)}</td><td>${repTexto(g.estado)}</td><td>${repTexto(g.condicion)}</td><td>${liqN(g.pesoGuia)}</td><td>${liqN(g.pesoSistema)}</td><td>${liqN(g.diferencia)}</td><td>${liqUSD(g.tarifaAduana)}</td><td>${liqUSD(g.costoAduana)}</td></tr>`).join('');
    $('liq-resultados').hidden=false;liqValido=true;$('liq-aprobar').checked=false;['liq-pdf','liq-png','liq-csv'].forEach(id=>$(id).disabled=true);
    $('liq-estado').textContent=`Vista previa calculada: ${liqGuias.length} guía(s), ${filas.length} corte(s), ${filas.reduce((n,f)=>n+f.paquetes,0)} paquete(s). Revisá y autorizá antes de exportar.`;
  }catch(e){console.error('Liquidación',e);$('liq-estado').textContent='No se pudo calcular: '+e.message;}
  finally{btn.disabled=false;}
}
function liqExportRows(){
  const r=[['BioMax · Liquidación de carga'],['Generado',new Date().toLocaleString('es-NI')],[],['GUÍAS','Transportista','Corte(s)','Modalidad','Entrega','Estado','Condición','Peso guía','Peso BioMax','Diferencia','Tarifa Aduana','Costo Aduana']];
  liqTotales.guias.forEach(g=>r.push([g.numero,g.transportista,g.cortes,g.modalidad,g.entrega,g.estado,g.condicion,liqN(g.pesoGuia),liqN(g.pesoSistema),liqN(g.diferencia),liqUSD(g.tarifaAduana),liqUSD(g.costoAduana)]));
  r.push([],['DESGLOSE'],['Maestra','Agencia','Guía','Corte','Modalidad','Paquetes','Peso original','Adicional','Peso liquidado','Tarifa Aduana/lb','Costo Aduana','Tarifa Agencia/lb','Cobro Agencia','Margen']);
  liqFilas.forEach(f=>r.push([f.maestra,f.agencia,f.guia,f.corte,f.modalidad,f.paquetes,liqN(f.peso),liqN(f.extra),liqN(f.final),liqUSD(f.tarifaAduana),liqUSD(f.costoAduana),liqUSD(f.tarifa),liqUSD(f.total),liqUSD(f.margen)]));
  r.push([],['COBROS POR AGENCIA MAESTRA','Total a entregar']);for(const m of ['BIO','MML'])r.push([m,liqUSD(liqFilas.filter(f=>f.maestra===m).reduce((n,f)=>n+f.total,0))]);
  r.push([],['TOTALES GENERALES'],['Peso de guías',liqN(liqTotales.pesoGuia)+' lbs'],['Peso BioMax',liqN(liqTotales.pesoSistema)+' lbs'],['Diferencia',liqN(liqTotales.diferencia)+' lbs'],['Costo real Aduana',liqUSD(liqTotales.costoAduanaTotal)],['Total a recibir',liqUSD(liqTotales.cobroTotal)],['Ganancia / pérdida',liqUSD(liqTotales.ganancia)]);return r;
}
function liqCSV(){if(!liqValido||!$('liq-aprobar').checked)return;const rows=liqExportRows();const csv='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='BioMax_Liquidacion_Carga.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function liqPDF(){if(!liqValido||!$('liq-aprobar').checked)return;const win=window.open('','_blank');if(!win){alert('Permití las ventanas emergentes para guardar el PDF.');return;}const rows=liqExportRows();const tabla=rows.map(r=>'<tr>'+r.map(v=>`<td>${repTexto(v)}</td>`).join('')+'</tr>').join('');win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>BioMax - Liquidación</title><style>@page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;color:#172238}table{border-collapse:collapse;width:100%;font-size:9px}td{border:1px solid #ccd3de;padding:5px}tr:first-child{background:#dceaf9;font-weight:bold}tr{break-inside:avoid}h1{font-size:22px}</style></head><body><h1>BioMax · Liquidación de carga</h1><table>${tabla}</table><p>Resumen generado desde BioMax. Verificar datos antes de efectuar transferencias.</p></body></html>`);win.document.close();win.focus();setTimeout(()=>win.print(),350);}
function liqPNG(){if(!liqValido||!$('liq-aprobar').checked)return;const rows=liqExportRows(),cols=Math.max(...rows.map(r=>r.length)),cellW=148,w=Math.max(1250,cols*cellW+32),rowH=34,h=115+rows.length*rowH,cv=document.createElement('canvas');cv.width=w*2;cv.height=h*2;const ctx=cv.getContext('2d');ctx.scale(2,2);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.fillStyle='#14213d';ctx.font='bold 27px Arial';ctx.fillText('BioMax · Liquidación de carga',20,40);ctx.font='14px Arial';ctx.fillText(new Date().toLocaleString('es-NI'),20,68);rows.forEach((r,i)=>{const y=100+i*rowH;ctx.fillStyle=i%2?'#f3f6fb':'#fff';ctx.fillRect(12,y-22,w-24,rowH);ctx.fillStyle='#14213d';ctx.font='12px Arial';r.forEach((v,j)=>{const str=String(v);ctx.fillText(str.length>22?str.slice(0,21)+'…':str,20+j*cellW,y);});});cv.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='BioMax_Liquidacion_Carga.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');}

async function initAdminDashboard() {
  const ctx = await cargarPerfilSesion();
  if (!ctx) return;

  aplicarPermisosPorRol(ctx.rol);

  setupNavegacion();
  setupModalesGlobales();
  setupLogout();
  setupAgencySwitcher();
  setupFormCrearCorte();
  setupFormBultos();
  setupSolicitudesSucursal();
  setupReportesOperativos();
  setupLiquidacion();

  if (ctx.rol === "admin") {
    setupPasswordTools();
  }

  $("app-logo-file")?.addEventListener("change", (event) => {
    const fileChosen = $("file-chosen");
    if (fileChosen) {
      fileChosen.textContent =
        event.target.files?.[0]?.name || "Ningún archivo seleccionado";
    }
  });

  const email = ctx.session.user.email || "Usuario";
  const info = $("admin-user-info");
  const avatar = $("admin-avatar");
  if (info) info.textContent = email.split("@")[0];
  if (avatar) {
    avatar.textContent = email.slice(0, 2).toUpperCase();
  }

  await refreshAllData();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminDashboard);
} else {
  initAdminDashboard();
}

window.refreshAllData = refreshAllData;
