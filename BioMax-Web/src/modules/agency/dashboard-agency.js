import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm";
import { SUPABASE_CONFIG } from "../../core/js/config.js";

const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
window.supabase = supabase;

let agenciaActual = null;
let corteSeleccionadoActual = null;
let bultosCorteActual = [];
let chartCostosAgencia = null;
let cortesTarjetasCache = [];
let bultosPorCorteCache = {};

// ========== NUEVO: Estados de seguimiento (igual que Admin) ==========
const ESTADO_ENVIO_OPTIONS = [
  { value: "despachado_miami", label: "Despachado a Almacén Miami" },
  { value: "transito_managua", label: "Tránsito a Managua" },
  { value: "recibido_managua", label: "Recibido Almacén Managua" },
  { value: "entregado", label: "Entregado" },
];

function textoEstadoEnvio(val) {
  const k = String(val || "despachado_miami")
    .toLowerCase()
    .trim();
  const found = ESTADO_ENVIO_OPTIONS.find((o) => o.value === k);
  return found ? found.label : val || "—";
}

function badgeEstadoEnvio(val) {
  const label = textoEstadoEnvio(val);
  const k = String(val || "")
    .toLowerCase()
    .trim();
  let cls = "badge-warning";
  if (k === "entregado") cls = "badge-success";
  else if (k === "recibido_managua") cls = "badge-info";
  else if (k === "transito_managua") cls = "badge-info";
  else if (k === "despachado_miami") cls = "badge-warning";
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}
// ===================================================================

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

function abrirModalFotoBulto(url) {
  if (!url) return;
  const img = $("foto-bulto-preview");
  if (img) {
    img.src = url;
    img.alt = "Foto del bulto";
  }
  openModal("modal-foto-bulto");
}

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

function formatMoney(n) {
  return `$${parseFloat(n || 0).toFixed(2)}`;
}

function fechaCorteTexto(corte) {
  const raw = corte?.fecha_corte || corte?.fecha_estimada || null;
  if (!raw) return "Pendiente";
  try {
    return new Date(raw).toLocaleDateString("es-NI");
  } catch {
    return String(raw).slice(0, 10);
  }
}

function fechaKey(raw) {
  if (!raw) return null;
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(raw).slice(0, 10);
  }
}

function badgeHtml(estado) {
  const e = (estado || "").toLowerCase();
  if (
    e === "activo" ||
    e === "activa" ||
    e === "entregado" ||
    e === "pagado" ||
    e === "aprobado" ||
    e === "resuelto" ||
    e === "cerrado"
  ) {
    return `<span class="badge badge-success">${escapeHtml(estado || "Activo")}</span>`;
  }
  if (e === "inactivo" || e === "rechazado") {
    return `<span class="badge badge-danger">${escapeHtml(estado || "Inactivo")}</span>`;
  }
  if (e === "recibido" || e === "en_proceso") {
    return `<span class="badge badge-info">${escapeHtml(e === "en_proceso" ? "En proceso" : estado)}</span>`;
  }
  return `<span class="badge badge-warning">${escapeHtml(estado || "Pendiente")}</span>`;
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

    if (btn) {
      btn.onclick = null;
      btn.onclick = () => {
        hide(modal);
        resolve(true);
      };
    } else {
      resolve(true);
    }
  });
}

function mostrarConfirmacion(titulo, mensaje) {
  return new Promise((resolve) => {
    const modal = $("custom-confirm-modal");
    if (!modal) {
      resolve(window.confirm(`${titulo}\n\n${mensaje}`));
      return;
    }
    const titleEl = $("custom-confirm-title");
    const msgEl = $("custom-confirm-message");
    const btnYes = $("custom-confirm-yes");
    const btnNo = $("custom-confirm-no");

    if (titleEl) titleEl.textContent = titulo;
    if (msgEl) msgEl.textContent = mensaje;
    show(modal);

    const clean = (val) => {
      hide(modal);
      if (btnYes) btnYes.onclick = null;
      if (btnNo) btnNo.onclick = null;
      resolve(val);
    };
    if (btnYes) btnYes.onclick = () => clean(true);
    if (btnNo) btnNo.onclick = () => clean(false);
  });
}

function setupNavegacion() {
  const navLinks = document.querySelectorAll(".nav-link");
  const views = document.querySelectorAll(".dashboard-view");
  const pageTitle = $("page-title");

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navLinks.forEach((l) => {
        l.classList.remove("active");
        l.removeAttribute("aria-current");
      });
      link.classList.add("active");
      link.setAttribute("aria-current", "page");

      const targetId = link.getAttribute("data-target");
      views.forEach((v) => {
        v.hidden = v.id !== targetId;
      });

      if (pageTitle) {
        const span = link.querySelector("span");
        pageTitle.textContent = span
          ? span.textContent.trim()
          : link.textContent.trim();
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

// DASHBOARD RESUMEN
async function cargarDashboardAgencia(agenciaId) {
  if (!agenciaId) return;

  const hace30 = new Date();
  hace30.setDate(hace30.getDate() - 30);
  const desdeISO = hace30.toISOString();

  const [resClientes, resCortes, resBultos] = await Promise.all([
    supabase
      .from("clientes_agencia")
      .select("id, estado")
      .eq("agencia_id", agenciaId),
    supabase
      .from("cortes_contenedores")
      .select("*")
      .eq("agencia_id", agenciaId)
      .order("created_at", { ascending: false }),
    supabase
      .from("paquetes_bultos")
      .select("id, corte_id, peso_lbs, costo, created_at")
      .eq("agencia_id", agenciaId),
  ]);

  const clientes = resClientes.data || [];
  let cortes = resCortes.data || [];
  if (resCortes.error) {
    const alt = await supabase
      .from("cortes_contenedores")
      .select("*")
      .eq("agencia_id", agenciaId)
      .order("creada_en", { ascending: false });
    cortes = alt.data || [];
  }

  const cortesAgencia = cortes.filter(
    (c) => String(c.agencia_id) === String(agenciaId),
  );

  let bultos = resBultos.data || [];
  if (resBultos.error || bultos.length === 0) {
    const idsCortes = cortesAgencia.map((c) => c.id).filter(Boolean);
    if (idsCortes.length > 0) {
      const { data: b2 } = await supabase
        .from("paquetes_bultos")
        .select("id, corte_id, peso_lbs, costo, created_at")
        .in("corte_id", idsCortes);
      bultos = b2 || [];
    }
  }

  const activos = clientes.filter((c) => (c.estado || "activo") === "activo");
  if ($("stat-clientes-agente")) {
    $("stat-clientes-agente").textContent = String(activos.length);
  }
  if ($("stat-paquetes-transito")) {
    $("stat-paquetes-transito").textContent = String(bultos.length);
  }
  if ($("stat-contenedores-agente")) {
    $("stat-contenedores-agente").textContent = String(cortesAgencia.length);
  }

  const pendientes = cortesAgencia.filter((c) => {
    const e = (c.estado || "Pendiente").toLowerCase();
    return e === "pendiente" || e === "abierto" || e === "";
  });
  if ($("stat-pendientes-recibir")) {
    $("stat-pendientes-recibir").textContent = String(pendientes.length);
  }

  let saldoTotal = 0;
  let pagado30 = 0;
  const porDia = {};

  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    porDia[d.toISOString().slice(0, 10)] = 0;
  }

  cortesAgencia.forEach((c) => {
    const costo = parseFloat(c.costo_total || 0);
    const pagado = parseFloat(c.total_pagado || 0);
    saldoTotal += Math.max(0, costo - pagado);

    const key =
      fechaKey(c.fecha_corte) ||
      fechaKey(c.created_at) ||
      fechaKey(c.creada_en);
    if (key && Object.prototype.hasOwnProperty.call(porDia, key)) {
      porDia[key] += costo;
    }

    const rawFecha =
      c.fecha_cierre || c.updated_at || c.created_at || c.fecha_corte;
    if (rawFecha) {
      try {
        const fd = new Date(rawFecha);
        if (fd >= hace30) pagado30 += pagado;
      } catch {
        /* ignore */
      }
    }
  });

  if (pagado30 === 0) {
    cortesAgencia.forEach((c) => {
      const e = (c.estado || "").toLowerCase();
      if (e === "pagado" || e === "cerrado") {
        const key =
          fechaKey(c.fecha_cierre) ||
          fechaKey(c.created_at) ||
          fechaKey(c.fecha_corte);
        if (key && key >= desdeISO.slice(0, 10)) {
          pagado30 += parseFloat(c.costo_total || 0);
        }
      }
    });
  }

  if ($("stat-saldo-pagar")) {
    $("stat-saldo-pagar").textContent = formatMoney(saldoTotal);
  }
  if ($("stat-pagado-30")) {
    $("stat-pagado-30").textContent = formatMoney(pagado30);
  }
  if ($("saldo-disponible")) {
    $("saldo-disponible").textContent = formatMoney(saldoTotal);
  }

  const labels = Object.keys(porDia).sort();
  const values = labels.map((k) => porDia[k]);
  renderChartCostosAgencia(labels, values);
  renderEstadosContenedoresAgencia(cortesAgencia);
  renderContenedoresRecientes(cortesAgencia);
}

function renderChartCostosAgencia(labels, values) {
  const canvas = $("chart-costos-agencia-30");
  if (!canvas || typeof Chart === "undefined") return;

  const ctx = canvas.getContext("2d");
  if (chartCostosAgencia) {
    chartCostosAgencia.destroy();
    chartCostosAgencia = null;
  }

  const labelsCortas = labels.map((l) => {
    const parts = l.split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : l;
  });

  chartCostosAgencia = new Chart(ctx, {
    type: "line",
    data: {
      labels: labelsCortas,
      datasets: [
        {
          label: "Costo ($)",
          data: values,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.12)",
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          pointRadius: 2,
          pointHoverRadius: 5,
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
          ticks: {
            callback: (v) => `$${v}`,
            font: { size: 11 },
          },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
        },
      },
    },
  });
}

function renderEstadosContenedoresAgencia(cortes) {
  const cont = $("estados-contenedores-agencia");
  if (!cont) return;

  if (!cortes || cortes.length === 0) {
    cont.innerHTML = `<p class="empty-msg">Sin datos de contenedores.</p>`;
    return;
  }

  const map = {
    Pendiente: 0,
    Recibido: 0,
    Entregado: 0,
    Pagado: 0,
  };

  cortes.forEach((c) => {
    const e = (c.estado || "Pendiente").toLowerCase();
    if (e === "recibido") map.Recibido += 1;
    else if (e === "entregado") map.Entregado += 1;
    else if (e === "pagado" || e === "cerrado") map.Pagado += 1;
    else map.Pendiente += 1;
  });

  const total = cortes.length || 1;
  const colors = {
    Pendiente: "var(--color-warning-dot, #f59e0b)",
    Recibido: "var(--color-primary, #2563eb)",
    Entregado: "var(--color-success, #16a34a)",
    Pagado: "var(--color-navy, #172b4e)",
  };

  cont.innerHTML = Object.entries(map)
    .map(([label, count]) => {
      const pct = Math.round((count / total) * 100);
      return `
        <div class="status-bar-row">
          <div class="status-bar-meta">
            <span>${escapeHtml(label)}</span>
            <span>${count} (${pct}%)</span>
          </div>
          <div class="status-bar-track">
            <div class="status-bar-fill" style="width:${pct}%;background:${colors[label]}"></div>
          </div>
        </div>`;
    })
    .join("");
}

function renderContenedoresRecientes(cortes) {
  const lista = $("lista-contenedores-recientes");
  if (!lista) return;

  if (!cortes || cortes.length === 0) {
    lista.innerHTML = `<p class="empty-msg">No hay contenedores recientes.</p>`;
    return;
  }

  const recientes = [...cortes].slice(0, 8);
  lista.innerHTML = "";

  recientes.forEach((c) => {
    const item = document.createElement("div");
    item.className = "activity-item";
    item.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--color-border)";

    const costo = parseFloat(c.costo_total || 0);
    const pagado = parseFloat(c.total_pagado || 0);
    const saldo = Math.max(0, costo - pagado);

    item.innerHTML = `
      <div style="min-width:0">
        <strong style="font-size:var(--text-sm)">${escapeHtml((c.tipo_envio || "Envío").toUpperCase())} · Corte ${escapeHtml(c.numero_corte || "N/D")}</strong>
        <p class="cell-muted" style="margin:2px 0 0">${escapeHtml(fechaCorteTexto(c))} · ${formatMoney(costo)}${saldo > 0 ? ` · Saldo ${formatMoney(saldo)}` : ""}</p>
      </div>
      ${badgeHtml(c.estado || "Pendiente")}
    `;
    lista.appendChild(item);
  });
}

// INICIALIZACIÓN
async function initAgenteDashboard() {
  setupNavegacion();
  setupModalesGlobales();
  setupLogout();

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session) {
    window.location.href = "../../../index.html";
    return;
  }

  const userEmail = (session.user.email || "").trim().toLowerCase();

  try {
    const { data: agencias, error } = await supabase
      .from("agencias")
      .select("*");

    if (error) {
      console.error("Error consultando agencias:", error);
      await mostrarAlerta(
        "Error de conexión",
        "No se pudo conectar con la base de datos: " + error.message,
      );
      return;
    }

    const agencia = (agencias || []).find((ag) => {
      const c = (ag.correo || ag.email || "").trim().toLowerCase();
      return c === userEmail;
    });

    if (!agencia) {
      await mostrarAlerta(
        "Acceso restringido",
        `No se encontró una agencia vinculada al correo: ${userEmail}`,
      );
      return;
    }

    if (agencia.estado === "inactivo") {
      await mostrarAlerta(
        "Cuenta inactiva",
        "Tu agencia ha sido desactivada por el administrador global.",
      );
      await supabase.auth.signOut();
      window.location.href = "../../../index.html";
      return;
    }

    agenciaActual = agencia;
    poblarDatosPerfilAgencia(agencia);
    await Promise.all([
      cargarDashboardAgencia(agencia.id),
      cargarContenedoresDeSucursal(agencia.id),
      cargarClientesAgencia(agencia.id),
      cargarCortesAgenciaConBultos(agencia.id),
      cargarHistorialSolicitudes(agencia.id),
    ]);
    setupModalesSolicitudes();
    setupModalCliente();
    setupAbonoYCierreBultos();
    setupMarcarRecibido();
    setupBusquedaCortes();
  } catch (err) {
    console.error("Error inicializando panel de agente:", err);
    await mostrarAlerta(
      "Error",
      "Ocurrió un problema al cargar el perfil del agente.",
    );
  }
}

function poblarDatosPerfilAgencia(agencia) {
  const nombre = agencia.nombre || "Mi Sucursal";
  const codigo = agencia.codigo || "S/C";
  const contacto = agencia.contacto || agencia.nombre_contacto || "-";
  const telefono = agencia.telefono || agencia.celular || "-";
  const correo = agencia.correo || agencia.email || "-";
  const direccion = agencia.direccion || "-";
  const logoUrl = agencia.logo_url || "";

  const elNombreSidebar = $("agencia-nombre-sidebar");
  const elCodigoBadge = $("agencia-codigo-badge");
  const elUserName = $("agencia-user-name");
  const elTituloNombre = $("agente-titulo-nombre");
  const elAvatar = $("agencia-avatar");
  const elLogoSidebar = $("agencia-logo-sidebar");
  const elPerfLogo = $("perf-logo");

  if (elNombreSidebar) elNombreSidebar.textContent = nombre;
  if (elCodigoBadge) elCodigoBadge.textContent = codigo;
  if (elUserName) elUserName.textContent = nombre;
  if (elTituloNombre) elTituloNombre.textContent = nombre.toUpperCase();
  if (elAvatar) elAvatar.textContent = nombre.slice(0, 2).toUpperCase();

  if (elLogoSidebar && logoUrl) {
    elLogoSidebar.src = logoUrl;
    elLogoSidebar.alt = `Logo ${nombre}`;
    elLogoSidebar.hidden = false;
  }

  if (elPerfLogo && logoUrl) {
    elPerfLogo.src = logoUrl;
    elPerfLogo.alt = `Logo ${nombre}`;
    elPerfLogo.hidden = false;
  }

  if ($("perf-nombre")) $("perf-nombre").textContent = nombre;
  if ($("perf-codigo")) $("perf-codigo").textContent = codigo;
  if ($("perf-contacto")) $("perf-contacto").textContent = contacto;
  if ($("perf-telefono")) $("perf-telefono").textContent = telefono;
  if ($("perf-correo")) $("perf-correo").textContent = correo;
  if ($("perf-direccion")) $("perf-direccion").textContent = direccion;

  $("agencia-user-badge")?.addEventListener("click", () => {
    openModal("modal-perfil-agente");
  });
}

async function cargarClientesAgencia(agenciaId) {
  const tbody = $("tabla-clientes-body");
  const statClientes = $("stat-clientes-agente");
  if (!tbody) return;

  const { data: clientes, error } = await supabase
    .from("clientes_agencia")
    .select("*")
    .eq("agencia_id", agenciaId)
    .order("id", { ascending: true });

  if (error || !clientes || clientes.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No hay clientes registrados.</td></tr>`;
    if (statClientes) statClientes.textContent = "0";
    return;
  }

  const activos = clientes.filter((c) => (c.estado || "activo") === "activo");
  if (statClientes) statClientes.textContent = String(activos.length);

  tbody.innerHTML = "";
  clientes.forEach((cli) => {
    const esActivo = (cli.estado || "activo") === "activo";
    const tr = document.createElement("tr");
    if (!esActivo) tr.classList.add("row-inactive");
    tr.innerHTML = `
      <td><strong>#CLI-${escapeHtml(String(cli.id))}</strong></td>
      <td><strong>${escapeHtml(cli.nombre_cliente || "-")}</strong></td>
      <td>${escapeHtml(cli.telefono || "-")}</td>
      <td>${escapeHtml(cli.departamento || "-")}</td>
      <td>${escapeHtml(cli.direccion || "-")}</td>
      <td>${badgeHtml(esActivo ? "activo" : "inactivo")}</td>
      <td>
        <div class="actions-cell">
          <button type="button" class="btn-secondary btn-sm btn-editar-cliente" data-id="${escapeHtml(String(cli.id))}">Editar</button>
          <button type="button" class="btn-secondary btn-sm btn-toggle-cliente" data-id="${escapeHtml(String(cli.id))}" data-estado="${escapeHtml(cli.estado || "activo")}">
            ${esActivo ? "Desactivar" : "Activar"}
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btn-editar-cliente").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const cli = clientes.find((c) => String(c.id) === String(id));
      if (!cli) return;
      if ($("cli-edit-id")) $("cli-edit-id").value = String(cli.id);
      if ($("cli-nombre")) $("cli-nombre").value = cli.nombre_cliente || "";
      if ($("cli-telefono")) $("cli-telefono").value = cli.telefono || "";
      if ($("cli-departamento"))
        $("cli-departamento").value = cli.departamento || "";
      if ($("cli-direccion")) $("cli-direccion").value = cli.direccion || "";
      if ($("modal-cli-titulo"))
        $("modal-cli-titulo").textContent = "Editar cliente";
      openModal("modal-nuevo-cliente");
    });
  });

  tbody.querySelectorAll(".btn-toggle-cliente").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const actual = (
        btn.getAttribute("data-estado") || "activo"
      ).toLowerCase();
      const nuevo = actual === "activo" ? "inactivo" : "activo";
      const ok = await mostrarConfirmacion(
        "Cambiar estado",
        `¿Marcar cliente como ${nuevo}?`,
      );
      if (!ok) return;
      const { error: err } = await supabase
        .from("clientes_agencia")
        .update({ estado: nuevo })
        .eq("id", id);
      if (err) {
        await mostrarAlerta("Error", err.message);
        return;
      }
      await cargarClientesAgencia(agenciaId);
      await cargarDashboardAgencia(agenciaId);
    });
  });
}

function setupModalCliente() {
  $("btn-nuevo-cliente")?.addEventListener("click", () => {
    if ($("form-crear-cliente")) $("form-crear-cliente").reset();
    if ($("cli-edit-id")) $("cli-edit-id").value = "";
    if ($("modal-cli-titulo"))
      $("modal-cli-titulo").textContent = "Registrar cliente";
    openModal("modal-nuevo-cliente");
  });

  $("form-crear-cliente")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!agenciaActual) return;

    const editId = $("cli-edit-id")?.value;
    const nombre = $("cli-nombre")?.value.trim();
    const telefono = $("cli-telefono")?.value.trim();
    const departamento = $("cli-departamento")?.value.trim() || null;
    const direccion = $("cli-direccion")?.value.trim() || null;

    if (!nombre || !telefono) {
      await mostrarAlerta("Atención", "Nombre y teléfono son obligatorios.");
      return;
    }

    if (editId) {
      const { error } = await supabase
        .from("clientes_agencia")
        .update({
          nombre_cliente: nombre,
          telefono,
          departamento,
          direccion,
        })
        .eq("id", editId);
      if (error) {
        await mostrarAlerta("Error", error.message);
        return;
      }
      await mostrarAlerta("Éxito", "Cliente actualizado.");
    } else {
      const { data, error } = await supabase
        .from("clientes_agencia")
        .insert([
          {
            agencia_id: agenciaActual.id,
            nombre_cliente: nombre,
            telefono,
            departamento,
            direccion,
            estado: "activo",
          },
        ])
        .select()
        .single();

      if (error) {
        await mostrarAlerta("Error", "No se pudo registrar: " + error.message);
        return;
      }
      await mostrarAlerta(
        "Éxito",
        `Cliente ${nombre} registrado (#CLI-${data.id}).`,
      );
    }

    closeModal("modal-nuevo-cliente");
    e.target.reset();
    if ($("cli-edit-id")) $("cli-edit-id").value = "";
    await cargarClientesAgencia(agenciaActual.id);
    await cargarDashboardAgencia(agenciaActual.id);
  });
}

async function cargarContenedoresDeSucursal(agenciaId) {
  const tbody = $("tabla-contenedores-agente-body");
  if (!tbody) return;

  const { data: cortes, error } = await supabase
    .from("cortes_contenedores")
    .select("*")
    .eq("agencia_id", agenciaId)
    .order("created_at", { ascending: false });

  if (error || !cortes || cortes.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No hay contenedores asignados a tu sucursal.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  cortes.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.tipo_envio || "—")}</td>
      <td><strong>Corte ${escapeHtml(c.numero_corte || "N/D")}</strong></td>
      <td>${escapeHtml(fechaCorteTexto(c))}</td>
      <td>${badgeHtml(c.estado || "Pendiente")}</td>
      <td>${badgeEstadoEnvio(c.estado_envio)}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function cargarCortesAgenciaConBultos(agenciaId) {
  const grid = $("grid-cortes-tarjetas");
  if (!grid) return;

  const { data: cortes, error } = await supabase
    .from("cortes_contenedores")
    .select("*")
    .eq("agencia_id", agenciaId)
    .order("created_at", { ascending: false });

  if (error || !cortes || cortes.length === 0) {
    cortesTarjetasCache = [];
    bultosPorCorteCache = {};
    grid.innerHTML = `<p class="empty-msg">No hay contenedores asignados.</p>`;
    return;
  }

  const ids = cortes.map((c) => c.id);
  const { data: bultos } = await supabase
    .from("paquetes_bultos")
    .select("*")
    .in("corte_id", ids);

  bultosPorCorteCache = {};
  (bultos || []).forEach((b) => {
    const key = String(b.corte_id);
    if (!bultosPorCorteCache[key]) bultosPorCorteCache[key] = [];
    bultosPorCorteCache[key].push(b);
  });

  cortesTarjetasCache = cortes;
  renderGridCortes(cortesTarjetasCache);
}

function renderGridCortes(cortes) {
  const grid = $("grid-cortes-tarjetas");
  if (!grid) return;

  if (!cortes || cortes.length === 0) {
    grid.innerHTML = `<p class="empty-msg">No hay resultados para tu búsqueda.</p>`;
    return;
  }

  grid.innerHTML = "";
  cortes.forEach((c) => {
    const bultos = bultosPorCorteCache[String(c.id)] || [];
    const totalLbs = bultos.reduce(
      (s, b) => s + (parseFloat(b.peso_lbs) || 0),
      0,
    );
    const costo = parseFloat(c.costo_total || 0).toFixed(2);
    const card = document.createElement("article");
    card.className = "stat-card corte-card";
    card.style.cursor = "pointer";
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <strong>${escapeHtml((c.tipo_envio || "Envío").toUpperCase())} · Corte ${escapeHtml(c.numero_corte || "N/D")}</strong>
        ${badgeHtml(c.estado || "Pendiente")}
      </div>
      <p class="cell-muted" style="margin-bottom:4px">Fecha de corte: ${escapeHtml(fechaCorteTexto(c))}</p>
      <p class="cell-muted" style="margin-bottom:4px">${bultos.length} bulto(s) · ${totalLbs.toFixed(2)} lbs aprox</p>
      <div style="margin-bottom:8px">
        ${badgeEstadoEnvio(c.estado_envio)}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--color-border);padding-top:8px">
        <span style="font-size:12px;color:var(--color-text-muted)">Total</span>
        <span style="font-size:13px;font-weight:bold;color:var(--color-navy)">$${costo}</span>
      </div>
    `;
    card.addEventListener("click", () => abrirModalBultosAgente(c, bultos));
    grid.appendChild(card);
  });
}

function setupBusquedaCortes() {
  const input = $("buscar-corte-input");
  if (!input) return;

  input.addEventListener("input", () => {
    const q = (input.value || "").trim().toLowerCase();
    if (!q) {
      renderGridCortes(cortesTarjetasCache);
      return;
    }

    const filtrados = cortesTarjetasCache.filter((c) => {
      const bultos = bultosPorCorteCache[String(c.id)] || [];
      const textoCorte = [c.tipo_envio, c.numero_corte, c.estado, c.codigo_ref]
        .join(" ")
        .toLowerCase();

      if (textoCorte.includes(q)) return true;

      return bultos.some((b) => {
        const blob = [b.cliente_nombre, b.tracking, b.estado]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    });

    renderGridCortes(filtrados);
  });
}

function actualizarResumenCostosModal(corte, bultos) {
  const costo = parseFloat(corte?.costo_total || 0);
  const pagado = parseFloat(corte?.total_pagado || 0);
  const saldo = Math.max(0, costo - pagado);
  const totalLbs = (bultos || []).reduce(
    (s, b) => s + (parseFloat(b.peso_lbs) || 0),
    0,
  );

  if ($("costo-total-val"))
    $("costo-total-val").textContent = formatMoney(costo);
  if ($("total-pagado-val"))
    $("total-pagado-val").textContent = formatMoney(pagado);
  if ($("saldo-pagar-val"))
    $("saldo-pagar-val").textContent = formatMoney(saldo);
  if ($("desglose-bultos-text")) {
    $("desglose-bultos-text").textContent =
      `${corte?.tipo_envio || "Envío"}: ${(bultos || []).length} bultos · ${totalLbs.toFixed(2)} lbs aprox · Costo: ${formatMoney(costo)}`;
  }
  actualizarBotonRecibido(corte);
}

function actualizarBotonRecibido(corte) {
  const btn = $("btn-marcar-recibido");
  if (!btn) return;
  const est = (corte?.estado || "Pendiente").toLowerCase();
  if (
    est === "recibido" ||
    est === "entregado" ||
    est === "pagado" ||
    est === "cerrado"
  ) {
    btn.disabled = true;
    btn.textContent = est === "recibido" ? "Recibido" : "Actualizado";
  } else {
    btn.disabled = false;
    btn.textContent = "Actualizar";
  }
}

function abrirModalBultosAgente(corte, bultos) {
  corteSeleccionadoActual = { ...corte };
  bultosCorteActual = bultos || [];
  const modal = $("modal-detalle-corte-bultos");
  if (!modal) return;

  const totalLbs = (bultos || []).reduce(
    (s, b) => s + (parseFloat(b.peso_lbs) || 0),
    0,
  );

  if ($("bulto-modal-titulo")) {
    $("bulto-modal-titulo").textContent =
      `Bultos · ${(corte.tipo_envio || "Envío").toUpperCase()} · Corte ${corte.numero_corte || "N/D"}`;
  }
  if ($("bulto-modal-sub")) {
    $("bulto-modal-sub").textContent =
      `Fecha de corte: ${fechaCorteTexto(corte)} · Bultos: ${(bultos || []).length} · ${totalLbs.toFixed(2)} lbs aprox`;
  }

  // NUEVO: Mostrar estado de seguimiento en el modal
  const badgeEl = $("estado-seguimiento-badge");
  if (badgeEl) {
    badgeEl.innerHTML = badgeEstadoEnvio(corte.estado_envio);
  }

  actualizarResumenCostosModal(corte, bultos);

  const tbody = $("tabla-bultos-body");
  if (tbody) {
    if (!bultos || bultos.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No hay bultos registrados en este corte.</td></tr>`;
    } else {
      tbody.innerHTML = "";
      bultos.forEach((b, idx) => {
        const estadoActual = b.estado || "Pendiente";
        const fotoHtml = b.foto_url
          ? `<button type="button" class="thumb btn-ver-foto" data-foto="${escapeHtml(b.foto_url)}" title="Ver foto" style="border:0;background:transparent;padding:0;cursor:pointer;line-height:0;flex-shrink:0">
               <img src="${escapeHtml(b.foto_url)}" alt="Foto bulto" style="width:40px;height:40px;object-fit:cover;border-radius:6px;display:block" />
             </button>`
          : `<span class="cell-muted" style="font-size:11px;flex-shrink:0">Sin foto</span>`;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              ${fotoHtml}
              <strong>${escapeHtml(b.tracking || "-")}</strong>
            </div>
          </td>
          <td>${escapeHtml(b.cliente_nombre || "-")}</td>
          <td>${parseFloat(b.peso_lbs || 0).toFixed(2)} lbs</td>
          <td>
            <select class="form-input select-cambiar-estado-bulto" data-id="${escapeHtml(String(b.id))}" style="font-size:11px;padding:4px 6px;min-width:7rem">
              <option value="Pendiente" ${estadoActual === "Pendiente" ? "selected" : ""}>Pendiente</option>
              <option value="Recibido" ${estadoActual === "Recibido" ? "selected" : ""}>Recibido</option>
              <option value="Entregado" ${estadoActual === "Entregado" ? "selected" : ""}>Entregado</option>
            </select>
          </td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll(".btn-ver-foto").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const url = btn.getAttribute("data-foto");
          if (url) abrirModalFotoBulto(url);
        });
      });

      tbody.querySelectorAll(".select-cambiar-estado-bulto").forEach((sel) => {
        sel.addEventListener("change", async (e) => {
          const bultoId = e.target.getAttribute("data-id");
          const nuevoEst = e.target.value;
          const prev = e.target.dataset.prev || "Pendiente";

          const { error } = await supabase
            .from("paquetes_bultos")
            .update({ estado: nuevoEst })
            .eq("id", bultoId);

          if (error) {
            e.target.value = prev;
            await mostrarAlerta(
              "Error",
              "No se pudo actualizar el estado: " + error.message,
            );
            return;
          }

          e.target.dataset.prev = nuevoEst;

          const local = bultosCorteActual.find(
            (x) => String(x.id) === String(bultoId),
          );
          if (local) local.estado = nuevoEst;

          const todosEntregados =
            bultosCorteActual.length > 0 &&
            bultosCorteActual.every(
              (x) => (x.estado || "Pendiente") === "Entregado",
            );

          if (todosEntregados && corteSeleccionadoActual) {
            const estadoActualCorte = (
              corteSeleccionadoActual.estado || ""
            ).toLowerCase();
            if (
              estadoActualCorte !== "pagado" &&
              estadoActualCorte !== "cerrado"
            ) {
              await supabase
                .from("cortes_contenedores")
                .update({ estado: "Entregado" })
                .eq("id", corteSeleccionadoActual.id);
              corteSeleccionadoActual.estado = "Entregado";
              actualizarBotonRecibido(corteSeleccionadoActual);
            }
          }

          if (agenciaActual) {
            await Promise.all([
              cargarCortesAgenciaConBultos(agenciaActual.id),
              cargarContenedoresDeSucursal(agenciaActual.id),
              cargarDashboardAgencia(agenciaActual.id),
            ]);
          }
        });

        sel.dataset.prev = sel.value;
      });
    }
  }

  show(modal);
}

async function marcarContenedorComoRecibido() {
  if (!corteSeleccionadoActual || !agenciaActual) return;

  const est = (corteSeleccionadoActual.estado || "").toLowerCase();
  if (
    est === "recibido" ||
    est === "entregado" ||
    est === "pagado" ||
    est === "cerrado"
  ) {
    await mostrarAlerta(
      "Info",
      "Este contenedor ya está marcado como recibido o cerrado.",
    );
    return;
  }

  const ok = await mostrarConfirmacion(
    "Actualizar contenedor",
    "¿Confirmas que el contenedor ya está en la sucursal? Pasará a «Recibido» y el administrador lo verá.",
  );
  if (!ok) return;

  const corteId = corteSeleccionadoActual.id;

  const { error: errCorte } = await supabase
    .from("cortes_contenedores")
    .update({ estado: "Recibido" })
    .eq("id", corteId);

  if (errCorte) {
    await mostrarAlerta(
      "Error",
      "No se pudo actualizar el contenedor: " + errCorte.message,
    );
    return;
  }

  const idsPendientes = (bultosCorteActual || [])
    .filter((b) => {
      const e = (b.estado || "Pendiente").toLowerCase();
      return e === "pendiente" || e === "";
    })
    .map((b) => b.id);

  if (idsPendientes.length > 0) {
    const { error: errBultos } = await supabase
      .from("paquetes_bultos")
      .update({ estado: "Recibido" })
      .in("id", idsPendientes);

    if (errBultos) {
      console.warn("Corte actualizado; algunos bultos no:", errBultos);
    } else {
      bultosCorteActual.forEach((b) => {
        if (idsPendientes.includes(b.id)) b.estado = "Recibido";
      });
    }
  }

  corteSeleccionadoActual.estado = "Recibido";
  actualizarBotonRecibido(corteSeleccionadoActual);

  document.querySelectorAll(".select-cambiar-estado-bulto").forEach((sel) => {
    const id = sel.getAttribute("data-id");
    const b = bultosCorteActual.find((x) => String(x.id) === String(id));
    if (b && (b.estado || "") === "Recibido") {
      sel.value = "Recibido";
      sel.dataset.prev = "Recibido";
    }
  });

  await mostrarAlerta("Éxito", "Contenedor actualizado a Recibido.");

  await Promise.all([
    cargarCortesAgenciaConBultos(agenciaActual.id),
    cargarContenedoresDeSucursal(agenciaActual.id),
    cargarDashboardAgencia(agenciaActual.id),
  ]);
}

function setupMarcarRecibido() {
  $("btn-marcar-recibido")?.addEventListener("click", () => {
    marcarContenedorComoRecibido();
  });
}

async function registrarAbonoCorte(corteId, nuevoTotalPagado, nuevoEstado) {
  const payload = {
    total_pagado: nuevoTotalPagado,
    estado: nuevoEstado,
  };

  if (nuevoEstado === "Pagado") {
    payload.fecha_cierre = new Date().toISOString();
  }

  let { error } = await supabase
    .from("cortes_contenedores")
    .update(payload)
    .eq("id", corteId);

  if (error && String(error.message || "").includes("total_pagado")) {
    const { error: err2 } = await supabase
      .from("cortes_contenedores")
      .update({ estado: nuevoEstado })
      .eq("id", corteId);

    return {
      ok: false,
      partial: !err2,
      error:
        "Falta la columna total_pagado en cortes_contenedores. Ejecuta en Supabase:\n\nALTER TABLE cortes_contenedores ADD COLUMN IF NOT EXISTS total_pagado DECIMAL(10,2) DEFAULT 0;",
    };
  }

  if (error && String(error.message || "").includes("fecha_cierre")) {
    delete payload.fecha_cierre;
    ({ error } = await supabase
      .from("cortes_contenedores")
      .update(payload)
      .eq("id", corteId));
  }

  if (error) return { ok: false, partial: false, error: error.message };
  return { ok: true, partial: false, error: null };
}

function setupAbonoYCierreBultos() {
  $("btn-abonar-monto")?.addEventListener("click", async () => {
    if (!corteSeleccionadoActual || !agenciaActual) return;

    const costo = parseFloat(corteSeleccionadoActual.costo_total || 0);
    const pagadoActual = parseFloat(corteSeleccionadoActual.total_pagado || 0);
    const saldo = Math.max(0, costo - pagadoActual);

    if (saldo <= 0) {
      await mostrarAlerta(
        "Info",
        "Este contenedor ya está completamente pagado.",
      );
      return;
    }

    const modalAbono = $("modal-abonar");
    const inputAbono = $("abono-monto-input");
    const labelSaldo = $("abono-saldo-label");
    const formAbono = $("form-abonar");

    if (modalAbono && inputAbono) {
      if (labelSaldo)
        labelSaldo.textContent = `Saldo pendiente: ${formatMoney(saldo)}`;
      inputAbono.value = saldo.toFixed(2);
      inputAbono.max = String(saldo);
      openModal("modal-abonar");

      if (formAbono) {
        formAbono.onsubmit = async (ev) => {
          ev.preventDefault();
          const abonoNum = parseFloat(inputAbono.value);
          if (!Number.isFinite(abonoNum) || abonoNum <= 0) {
            await mostrarAlerta("Atención", "Ingresa un monto válido.");
            return;
          }
          if (abonoNum > saldo + 0.001) {
            await mostrarAlerta(
              "Atención",
              `El abono no puede ser mayor al saldo (${formatMoney(saldo)}).`,
            );
            return;
          }

          const nuevoTotalPagado = pagadoActual + abonoNum;
          const nuevoEstado =
            nuevoTotalPagado >= costo - 0.001 ? "Pagado" : "Pendiente";

          const result = await registrarAbonoCorte(
            corteSeleccionadoActual.id,
            nuevoTotalPagado,
            nuevoEstado,
          );

          if (!result.ok) {
            await mostrarAlerta("Error", result.error || "No se pudo abonar.");
            if (!result.partial) return;
          }

          corteSeleccionadoActual.total_pagado = nuevoTotalPagado;
          corteSeleccionadoActual.estado = nuevoEstado;
          actualizarResumenCostosModal(
            corteSeleccionadoActual,
            bultosCorteActual,
          );
          closeModal("modal-abonar");

          await mostrarAlerta(
            "Éxito",
            nuevoEstado === "Pagado"
              ? `Abono de ${formatMoney(abonoNum)} registrado. Contenedor liquidado.`
              : `Abono de ${formatMoney(abonoNum)} registrado. Saldo restante: ${formatMoney(costo - nuevoTotalPagado)}.`,
          );

          await Promise.all([
            cargarCortesAgenciaConBultos(agenciaActual.id),
            cargarContenedoresDeSucursal(agenciaActual.id),
            cargarDashboardAgencia(agenciaActual.id),
          ]);
        };
      }
    }
  });
}

// SOLICITUDES DE SUCURSAL
function setupModalesSolicitudes() {
  const openVel = () => openModal("modal-sol-velocidad");
  const openInsp = () => openModal("modal-sol-inspeccion");
  const openCons = () => openModal("modal-sol-consolidor");
  const openHist = () => {
    if (agenciaActual) cargarHistorialSolicitudes(agenciaActual.id);
    openModal("modal-historial");
  };

  $("abrir-modal-velocidad")?.addEventListener("click", openVel);
  $("abrir-modal-inspeccion")?.addEventListener("click", openInsp);
  $("abrir-modal-consolidor")?.addEventListener("click", openCons);
  $("btn-historial-solicitudes")?.addEventListener("click", openHist);
  $("btn-top-velocidad")?.addEventListener("click", openVel);
  $("btn-top-inspeccionar")?.addEventListener("click", openInsp);
  $("btn-top-consolidor")?.addEventListener("click", openCons);
  $("btn-top-solicitudes")?.addEventListener("click", openHist);

  $("form-sol-velocidad")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const cliente = $("vel-cliente")?.value.trim() || "";
    const tracking = $("vel-tracking")?.value.trim() || "";
    const origen = $("vel-origen")?.value || "";
    const nuevo = $("vel-nuevo")?.value || "";

    if (!cliente || !tracking || !origen || !nuevo) {
      await mostrarAlerta(
        "Atención",
        "Completa todos los campos obligatorios.",
      );
      return;
    }

    await enviarSolicitudServicio({
      tipo: "Cambio de Velocidad",
      cliente,
      tracking,
      detalle: `Cambio: ${origen} → ${nuevo}`,
      meta: { velocidad_origen: origen, velocidad_nueva: nuevo },
    });
    closeModal("modal-sol-velocidad");
    e.target.reset();
  });

  $("form-sol-inspeccion")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const cliente = $("insp-cliente")?.value.trim() || "";
    const tracking = $("insp-tracking")?.value.trim() || "";
    const tipo = $("insp-tipo")?.value || "";

    if (!cliente || !tracking || !tipo) {
      await mostrarAlerta(
        "Atención",
        "Completa todos los campos obligatorios.",
      );
      return;
    }

    await enviarSolicitudServicio({
      tipo: "Inspeccionar",
      cliente,
      tracking,
      detalle: `Tipo de inspección: ${tipo}`,
      meta: { tipo_inspeccion: tipo },
    });
    closeModal("modal-sol-inspeccion");
    e.target.reset();
  });

  $("form-sol-consolidor")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const cliente = $("cons-cliente")?.value.trim() || "";
    const tracking = $("cons-tracking")?.value.trim() || "";
    const notas = $("cons-notas")?.value.trim() || "";

    if (!cliente || !tracking) {
      await mostrarAlerta(
        "Atención",
        "Completa cliente y números de tracking.",
      );
      return;
    }

    await enviarSolicitudServicio({
      tipo: "Consolidador",
      cliente,
      tracking,
      detalle: notas || "Solicitud de consolidación de paquetes",
      meta: notas ? { notas } : null,
    });
    closeModal("modal-sol-consolidor");
    e.target.reset();
  });
}

async function enviarSolicitudServicio({
  tipo,
  cliente,
  tracking,
  detalle,
  meta,
}) {
  if (!agenciaActual) return;

  const payload = {
    agencia_id: String(agenciaActual.id),
    agencia_nombre: agenciaActual.nombre || null,
    agencia_codigo: agenciaActual.codigo || null,
    tipo,
    cliente_nombre: cliente,
    tracking,
    detalle: detalle || null,
    meta: meta || null,
    estado: "pendiente",
  };

  const { error } = await supabase
    .from("solicitudes_sucursal")
    .insert([payload]);

  if (error) {
    console.error("Error guardando solicitud:", error);
    await mostrarAlerta(
      "Error",
      "No se pudo registrar la solicitud: " + error.message,
    );
    return;
  }

  await mostrarAlerta(
    "Solicitud enviada",
    `Tu solicitud de ${tipo} fue enviada al administrador.`,
  );
  await cargarHistorialSolicitudes(agenciaActual.id);
}

async function cargarHistorialSolicitudes(agenciaId) {
  const contenedor = $("contenedor-historial-lista");
  const badgeCount = $("badge-count-sol");
  const badgeHeader = $("badge-count-sol-header");

  const { data: solicitudes, error } = await supabase
    .from("solicitudes_sucursal")
    .select("*")
    .eq("agencia_id", String(agenciaId))
    .order("created_at", { ascending: false });

  if (error || !solicitudes || solicitudes.length === 0) {
    if (contenedor) {
      contenedor.innerHTML = `<p class="empty-msg">No hay solicitudes en el historial.</p>`;
    }
    if (badgeCount) badgeCount.textContent = "0";
    if (badgeHeader) {
      badgeHeader.textContent = "0";
      badgeHeader.hidden = true;
    }
    return;
  }

  const pendientes = solicitudes.filter(
    (s) => (s.estado || "").toLowerCase() === "pendiente",
  ).length;

  if (badgeCount) badgeCount.textContent = String(pendientes);
  if (badgeHeader) {
    badgeHeader.textContent = String(pendientes);
    badgeHeader.hidden = pendientes === 0;
  }

  if (!contenedor) return;

  contenedor.innerHTML = "";
  solicitudes.forEach((sol) => {
    const fechaFormateada = new Date(
      sol.created_at || Date.now(),
    ).toLocaleString("es-NI");

    const respuestaHtml = sol.respuesta_admin
      ? `<p class="cell-muted" style="margin-top:6px"><strong>Respuesta admin:</strong> ${escapeHtml(sol.respuesta_admin)}</p>`
      : "";

    const imagenHtml = sol.imagen_url
      ? `<p style="margin-top:6px"><button type="button" class="btn-secondary btn-sm btn-ver-evidencia" data-foto="${escapeHtml(sol.imagen_url)}">Ver evidencia</button></p>`
      : "";

    const item = document.createElement("div");
    item.className = "historial-item";
    item.style.cssText =
      "background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px;margin-bottom:10px";

    item.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px">
        <strong style="font-size:var(--text-sm)">${escapeHtml(sol.tipo || "Solicitud")}</strong>
        ${badgeHtml(sol.estado || "pendiente")}
      </div>
      <p class="cell-muted">Cliente: ${escapeHtml(sol.cliente_nombre || "N/D")}</p>
      <p class="cell-muted">Tracking: ${escapeHtml(sol.tracking || "—")}</p>
      <p class="cell-muted">${escapeHtml(sol.detalle || "")}</p>
      <p class="cell-muted">Fecha: ${escapeHtml(fechaFormateada)}</p>
      ${respuestaHtml}
      ${imagenHtml}
    `;
    contenedor.appendChild(item);
  });

  contenedor.querySelectorAll(".btn-ver-evidencia").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-foto");
      if (url) abrirModalFotoBulto(url);
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAgenteDashboard);
} else {
  initAgenteDashboard();
}
