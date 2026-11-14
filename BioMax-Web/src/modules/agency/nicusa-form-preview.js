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
