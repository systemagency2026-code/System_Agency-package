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

let agenciasCache = [];
let vistaSeleccionadaAnterior = "global";
let cortesCache = [];
let corteActualBultos = null;
let tarifaActualBultos = 0;
let chartIngresos = null;
let solicitudesSucursalCache = [];

// Rol de sesión (admin | operador)
let rolUsuario = "operador";
const VISTAS_OPERADOR = new Set([
  "view-cortes",
  "view-solicitudes-sucursal",
]);

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
    badge.textContent = esOperador
      ? "OPERACIONES"
      : "ADMINISTRACIÓN GLOBAL";
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
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(raw).slice(0, 10);
  }
}

function fechaCorteTexto(corte) {
  const key = fechaCorteKey(corte);
  if (!key) return "Pendiente";
  try {
    return new Date(key).toLocaleDateString("es-NI");
  } catch {
    return key;
  }
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

    const ahora = new Date();
    const hace30 = new Date(ahora);
    hace30.setDate(hace30.getDate() - 29);
    hace30.setHours(0, 0, 0, 0);

    let ingresos30 = 0;
    let saldoCobrar = 0;
    const porDia = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(hace30);
      d.setDate(hace30.getDate() + i);
      porDia[d.toISOString().slice(0, 10)] = 0;
    }

    const porAgencia = {};

    listaCortes.forEach((c) => {
      const costo = parseFloat(c.costo_total || 0);
      const pagado = parseFloat(c.total_pagado || 0);
      saldoCobrar += Math.max(0, costo - pagado);

      const key = fechaCorteKey(c);
      if (key && porDia[key] !== undefined) {
        porDia[key] += costo;
        ingresos30 += costo;
      } else if (key) {
        const fd = new Date(key);
        if (fd >= hace30 && fd <= ahora) {
          ingresos30 += costo;
          if (porDia[key] !== undefined) porDia[key] += costo;
        }
      }

      const aid = c.agencia_id || "sin";
      if (!porAgencia[aid]) {
        porAgencia[aid] = { id: aid, cortes: 0, costo: 0 };
      }
      porAgencia[aid].cortes += 1;
      porAgencia[aid].costo += costo;
    });

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

  // Probar columnas de fecha que pueden existir en tu esquema
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

  // Último recurso: sin ORDER BY
  if (error || cortes == null) {
    let query = supabase.from("cortes_contenedores").select("*");
    if (agVista) query = query.eq("agencia_id", agVista.id);
    const res = await query;
    cortes = res.data;
    error = res.error;
  }

  if (error) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Error: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  cortesCache = cortes || [];

  if (!cortes || cortes.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No hay contenedores.</td></tr>`;
    return;
  }

  // Orden en cliente (no depende de columnas del servidor)
  cortes.sort((a, b) => {
    const da = new Date(
      a.fecha_corte || a.created_at || a.creada_en || 0,
    ).getTime();
    const db = new Date(
      b.fecha_corte || b.created_at || b.creada_en || 0,
    ).getTime();
    return db - da;
  });

  tbody.innerHTML = "";
  cortes.forEach((c) => {
    const ag = agenciasCache.find((a) => String(a.id) === String(c.agencia_id));
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(ag?.nombre || c.agencia_id || "—")}</td>
      <td>${escapeHtml(c.tipo_envio || "—")}</td>
      <td>
        Corte ${escapeHtml(c.numero_corte || "N/D")}
        ${c.codigo_ref ? `<br><small class="cell-muted">#${escapeHtml(c.codigo_ref)}</small>` : ""}
      </td>
      <td>${escapeHtml(fechaCorteTexto(c))}</td>
      <td><strong>${formatMoney(c.costo_total)}</strong></td>
      <td>${badgeHtml(c.estado || "Pendiente")}</td>
      <td>
        <div class="actions-cell">
          <button type="button" class="btn-secondary btn-sm btn-gestionar-bultos" data-id="${escapeHtml(String(c.id))}">Bultos</button>
          <button type="button" class="btn-danger btn-sm btn-eliminar-corte" data-id="${escapeHtml(String(c.id))}">Eliminar</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
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

async function cargarClientesDeAgenciaEnSelect(agenciaId) {
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
  });
}

function setupFormBultos() {
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
    if ($("mg-total-corte")) $("mg-total-corte").textContent = "$0.00";
    return;
  }

  const total = bultos.reduce((s, b) => s + (parseFloat(b.costo) || 0), 0);
  if ($("mg-count-bultos"))
    $("mg-count-bultos").textContent = String(bultos.length);
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
