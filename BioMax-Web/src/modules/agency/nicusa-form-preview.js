// NIC → USA · etapa 2: interfaz de revisión, SIN escrituras ni almacenamiento.
function nicusaIniciarFormulario() {
  const peso = document.getElementById("nicusa-peso");
  const salida = document.getElementById("nicusa-peso-facturable");
  if (!peso || !salida || peso.dataset.nicusaReady) return;
  peso.dataset.nicusaReady = "1";
  const actualizar = () => {
    const raw = peso.value.trim();
    const n = Number(raw);
    salida.textContent = raw && Number.isFinite(n) && n > 0
      ? (Math.ceil(n * 2 - 1e-9) / 2).toFixed(2) + " lbs"
      : "—";
  };
  peso.addEventListener("input", actualizar);
  actualizar();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", nicusaIniciarFormulario);
} else {
  nicusaIniciarFormulario();
}

// Vista preliminar: selección múltiple de tipos de carga; sin cálculo de tarifas.
function nicusaIniciarCategorias() {
  const grupo = document.getElementById("nicusa-categorias");
  const salida = document.getElementById("nicusa-categorias-seleccionadas");
  if (!grupo || !salida || grupo.dataset.nicusaReady) return;
  grupo.dataset.nicusaReady = "1";
  const actualizar = () => {
    const seleccionadas = [...grupo.querySelectorAll('input[type="checkbox"]:checked')];
    salida.textContent = seleccionadas.length
      ? `${seleccionadas.length} tipo(s) de carga seleccionado(s). El costeo combinado se habilitará después.`
      : "Ninguna categoría seleccionada.";
  };
  grupo.addEventListener("change", actualizar);
  actualizar();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", nicusaIniciarCategorias);
} else {
  nicusaIniciarCategorias();
}
