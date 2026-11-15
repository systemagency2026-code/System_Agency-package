// BioMax NIC → USA · vista de pruebas, sin escrituras a Supabase.
// Categorías ilustrativas; no calcular cobros hasta disponer de tarifario autorizado.
(function () {
  const catalogo = {
    general: { nombre: "Carga general", unidad: "lbs" },
    medicamentos: { nombre: "Medicamentos", unidad: "lbs" },
    documentos: { nombre: "Documentos", unidad: "unidades" },
    otros: { nombre: "Otros (regla pendiente)", unidad: "pendiente" }
  };
  function iniciar() {
    const grupo = document.getElementById("nicusa-categorias");
    const detalle = document.getElementById("nicusa-detalle-cargas");
    const estado = document.getElementById("nicusa-categorias-seleccionadas");
    const real = document.getElementById("nicusa-peso-real-total");
    const facturable = document.getElementById("nicusa-peso-facturable");
    if (!grupo || !detalle || !estado || !real || !facturable || grupo.dataset.nicusaReady) return;
    grupo.dataset.nicusaReady = "1";
    const valores = Object.create(null);
    const redondear = n => Math.ceil(n * 2 - 1e-9) / 2;
    function recalcular() {
      let totalReal = 0, totalFacturable = 0, pesosValidos = 0;
      detalle.querySelectorAll("input[data-categoria]").forEach(input => {
        const categoria = input.dataset.categoria;
        const dato = catalogo[categoria];
        const valor = input.value.trim();
        valores[categoria] = valor;
        const numero = Number(valor.replace(",", "."));
        const output = document.getElementById("nicusa-calc-" + categoria);
        if (!valor || !Number.isFinite(numero) || numero <= 0 || (dato.unidad === "unidades" && !Number.isInteger(numero))) {
          if (output) output.textContent = dato.unidad === "pendiente" ? "Regla pendiente" : "—";
          return;
        }
        if (dato.unidad === "lbs") {
          const fact = redondear(numero);
          totalReal += numero;
          totalFacturable += fact;
          pesosValidos++;
          if (output) output.textContent = fact.toFixed(2) + " lbs facturables";
        } else if (output) {
          output.textContent = numero + " unidad(es)";
        }
      });
      real.textContent = pesosValidos ? totalReal.toFixed(2) + " lbs" : "—";
      facturable.textContent = pesosValidos ? totalFacturable.toFixed(2) + " lbs" : "—";
    }
    function renderizar() {
      const seleccionadas = [...grupo.querySelectorAll('input[type="checkbox"]:checked')].map(e => e.value);
      detalle.replaceChildren();
      seleccionadas.forEach(categoria => {
        const dato = catalogo[categoria];
        if (!dato) return;
        const fila = document.createElement("div");
        fila.className = "form-field";
        fila.style.cssText = "border:1px solid #dbe3ed;border-radius:12px;padding:12px;";
        const label = document.createElement("label");
        label.className = "form-label";
        const id = "nicusa-carga-" + categoria;
        label.htmlFor = id;
        label.textContent = dato.nombre + (dato.unidad === "lbs" ? " · peso real (lbs)" : dato.unidad === "unidades" ? " · cantidad de documentos" : " · pendiente de definir unidad");
        fila.appendChild(label);
        if (dato.unidad !== "pendiente") {
          const input = document.createElement("input");
          input.className = "form-input";
          input.id = id;
          input.dataset.categoria = categoria;
          input.type = "number";
          input.min = dato.unidad === "unidades" ? "1" : "0.01";
          input.step = dato.unidad === "unidades" ? "1" : "any";
          input.inputMode = dato.unidad === "unidades" ? "numeric" : "decimal";
          input.placeholder = dato.unidad === "unidades" ? "Ej. 2" : "Ej. 2.74";
          input.value = valores[categoria] || "";
          input.addEventListener("input", recalcular);
          fila.appendChild(input);
        }
        const resultado = document.createElement("output");
        resultado.id = "nicusa-calc-" + categoria;
        resultado.style.cssText = "display:block;margin-top:8px;font-weight:650;";
        fila.appendChild(resultado);
        detalle.appendChild(fila);
      });
      estado.textContent = seleccionadas.length ? seleccionadas.length + " tipo(s) de carga seleccionado(s). Sin tarifas ni guardado en esta vista." : "Ninguna categoría seleccionada.";
      recalcular();
    }
    grupo.addEventListener("change", renderizar);
    renderizar();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
