// BioMax NIC → USA · V7: registro real sujeto a migración y tarifas publicadas.
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
    const tarifas = Object.create(null);
    let agenciaTarifada = '';
    let solicitudTarifa = 0;
    const importe = document.getElementById('nicusa-importe-total');
    const estadoTarifa = document.getElementById('nicusa-estado-tarifas');
    const dinero = n => 'US$' + n.toFixed(2);
    async function cargarTarifas(agenciaId) {
      const actual = ++solicitudTarifa;
      agenciaTarifada = '';
      Object.keys(tarifas).forEach(k => delete tarifas[k]);
      if (importe) importe.textContent = '—';
      if (!agenciaId) {
        if (estadoTarifa) estadoTarifa.textContent = 'Seleccioná una agencia para consultar su tarifario.';
        recalcular(); return;
      }
      if (estadoTarifa) estadoTarifa.textContent = 'Consultando tarifas de la agencia…';
      const {data,error} = await sb.from('nicusa_tarifas_agencia')
        .select('categoria,precio,unidad').eq('agencia_id',agenciaId).limit(10);
      if (actual !== solicitudTarifa) return;
      if (error) {
        if (estadoTarifa) estadoTarifa.textContent = 'No se pudieron consultar las tarifas: ' + error.message;
        recalcular(); return;
      }
      (data || []).forEach(t => { tarifas[t.categoria] = t; });
      agenciaTarifada = agenciaId;
      if (estadoTarifa) estadoTarifa.textContent = (data || []).length
        ? 'Tarifas vigentes de la agencia seleccionada.'
        : 'Esta agencia todavía no tiene tarifas configuradas.';
      recalcular();
    }
    const redondear = n => Math.ceil(n * 2 - 1e-9) / 2;
    function recalcular() {
      let totalReal = 0, totalFacturable = 0, pesosValidos = 0, totalImporte = 0;
      let faltanTarifas = false;
      const seleccionadas = [...grupo.querySelectorAll('input[type="checkbox"]:checked')].map(e => e.value);
      detalle.querySelectorAll("input[data-categoria]").forEach(input => {
        const categoria = input.dataset.categoria;
        const dato = catalogo[categoria];
        const valor = input.value.trim();
        valores[categoria] = valor;
        const formatoValido = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(valor);
        const numero = formatoValido ? Number(valor.replace(",", ".")) : NaN;
        const output = document.getElementById("nicusa-calc-" + categoria);
        if (!valor || !formatoValido || !Number.isFinite(numero) || numero <= 0 || (dato.unidad === "unidades" && !Number.isInteger(numero))) {
          if (output) output.textContent = dato.unidad === "pendiente" ? "Regla pendiente" : "—";
          return;
        }
        const tarifa = tarifas[categoria];
        const unidadEsperada = dato.unidad === 'lbs' ? 'lb' : 'unidad';
        if (!tarifa || tarifa.unidad !== unidadEsperada || !Number.isFinite(Number(tarifa.precio))) faltanTarifas = true;
        if (dato.unidad === "lbs") {
          const fact = redondear(numero);
          totalReal += numero;
          totalFacturable += fact;
          pesosValidos++;
          if (tarifa && tarifa.unidad === 'lb' && Number.isFinite(Number(tarifa.precio))) {
            const subtotal = Math.round(fact * Number(tarifa.precio) * 100) / 100;
            totalImporte += subtotal;
            if (output) output.textContent = fact.toFixed(2) + ' lbs × ' + dinero(Number(tarifa.precio)) + '/lb = ' + dinero(subtotal);
          } else if (output) output.textContent = fact.toFixed(2) + ' lbs facturables · tarifa pendiente';
        } else {
          if (tarifa && tarifa.unidad === 'unidad' && Number.isFinite(Number(tarifa.precio))) {
            const subtotal = Math.round(numero * Number(tarifa.precio) * 100) / 100;
            totalImporte += subtotal;
            if (output) output.textContent = numero + ' unidad(es) × ' + dinero(Number(tarifa.precio)) + ' = ' + dinero(subtotal);
          } else if (output) output.textContent = numero + ' unidad(es) · tarifa pendiente';
        }
      });
      real.textContent = pesosValidos ? totalReal.toFixed(2) + " lbs" : "—";
      facturable.textContent = pesosValidos ? totalFacturable.toFixed(2) + " lbs" : "—";
      if (importe) importe.textContent = seleccionadas.length && !faltanTarifas && agenciaTarifada &&
        seleccionadas.every(c => c !== 'otros' && valores[c] && Number(valores[c].replace(',', '.')) > 0)
        ? dinero(totalImporte) : '—';
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
          input.type = "text";
          input.autocomplete = "off";
          
          input.pattern = dato.unidad === "unidades" ? "[0-9]+" : "[0-9]+([.,][0-9]+)?";
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
      estado.textContent = seleccionadas.length ? seleccionadas.length + " tipo(s) de carga seleccionado(s). " : "Ninguna categoría seleccionada.";
      recalcular();
    }
    const form = document.getElementById('nicusa-form');
    const aviso = document.getElementById('nicusa-aviso');
    const vuelo = document.getElementById('nicusa-vuelo');
    const boton = form?.querySelector('button[type="submit"]');
    const sb = window.supabase;
    async function cargarVuelos() {
      if (!sb) { aviso.textContent = 'No está disponible la conexión con Supabase.'; return; }
      const {data,error} = await sb.from('nicusa_vuelos').select('id,fecha').eq('publicado',true).gte('fecha',new Date().toISOString().slice(0,10)).order('fecha').limit(30);
      if(error) { aviso.textContent = 'V7 requiere la migración de base de datos aprobada. ' + error.message; return; }
      vuelo.replaceChildren(new Option('Seleccioná un vuelo',''));
      (data||[]).forEach(v=>vuelo.add(new Option(v.fecha,v.id)));
      vuelo.disabled = !(data||[]).length;
      if(boton) boton.disabled = !(data||[]).length;
      aviso.textContent = (data||[]).length ? 'Seleccioná el vuelo y completá todos los campos.' : 'No hay vuelos publicados. Contactá al SuperAdmin.';
    }
    form?.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!form.reportValidity()) return;
      const checks=[...grupo.querySelectorAll('input[type="checkbox"]:checked')];
      if(!checks.length || checks.some(c=>c.value==='otros')) { aviso.textContent='Seleccioná una categoría habilitada.';return; }
      const categorias={};
      for(const check of checks) {
        const value=document.getElementById('nicusa-carga-'+check.value)?.value.trim();
        if(!value || !/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value)) { aviso.textContent='Ingresá un peso o cantidad válido por categoría.';return; }
        const num=Number(value.replace(',','.'));
        if(!(num>0) || (check.value==='documentos'&&!Number.isInteger(num))) { aviso.textContent='Revisá los pesos y las unidades de documentos.';return; }
        categorias[check.value]=num;
      }
      const agenciaSeleccionada = document.getElementById('nicusa-agencia-admin')?.value || agenciaTarifada;
      if (!agenciaSeleccionada || agenciaSeleccionada !== agenciaTarifada ||
          checks.some(c => !tarifas[c.value] || tarifas[c.value].unidad !== (c.value === 'documentos' ? 'unidad' : 'lb'))) {
        aviso.textContent = 'No se puede registrar sin las tarifas vigentes de la agencia. Revisá el tarifario.';
        return;
      }
      const foto=document.getElementById('nicusa-foto').files[0];
      if(!foto || !['image/jpeg','image/png','image/webp'].includes(foto.type) || foto.size>5242880) { aviso.textContent='La foto debe ser JPG, PNG o WebP y máximo 5 MB.';return; }
      if(boton) boton.disabled=true;
      aviso.textContent='Registrando envío…';
      try {
        const {data:{user},error:authError}=await sb.auth.getUser();
        if(authError || !user) throw new Error('Sesión no válida');
        const {data:perfil,error:perfilError}=await sb.from('perfiles').select('agencia_id,rol,activo').eq('id',user.id).single();
        if(perfilError || !perfil?.activo) throw new Error('Perfil no autorizado');
        let agenciaId=perfil.agencia_id;
        if(perfil.rol==='admin') {
          const selector=document.getElementById('nicusa-agencia-admin');
          agenciaId=selector?.value;
          if(!agenciaId) throw new Error('Seleccioná una agencia');
        } else if(perfil.rol!=='agente' || !agenciaId) throw new Error('Acceso no autorizado');
        const extension=foto.type==='image/png'?'png':foto.type==='image/webp'?'webp':'jpg';
        const ruta=agenciaId+'/'+crypto.randomUUID()+'.'+extension;
        const {error:uploadError}=await sb.storage.from('nicusa-fotos').upload(ruta,foto,{contentType:foto.type,upsert:false});
        if(uploadError) throw uploadError;
        const campo=id=>document.getElementById('nicusa-'+id)?.value.trim()||'';
        const envio={agencia_id:agenciaId,vuelo_id:vuelo.value,remitente:campo('remitente'),remitente_telefono:campo('remitente-tel'),destinatario:campo('dest-nombre'),destinatario_telefono:campo('dest-tel'),calle:campo('calle'),apartamento:campo('apto'),ciudad:campo('ciudad'),estado:campo('estado'),zip:campo('zip'),categorias,inventario:campo('inventario'),observaciones:campo('notas'),foto_ruta:ruta};
        const {data,error}=await sb.from('nicusa_envios').insert(envio).select('id,importe_agencia').single();
        if(error) throw error;
        aviso.textContent='Envío registrado correctamente. Referencia: '+data.id.slice(0,8)+' · Importe: US$'+Number(data.importe_agencia).toFixed(2);
        form.reset(); renderizar();
      } catch(e) { aviso.textContent='No se pudo registrar: '+e.message; }
      finally { if(boton) boton.disabled=false; }
    });
    if(sb) sb.from('agencias').select('id,nombre').eq('estado','activa').order('nombre').limit(100).then(({data,error})=>{
      const sel=document.getElementById('nicusa-agencia-admin');
      if(!sel) return;
      sel.replaceChildren(new Option(error?'Error cargando agencias':'Seleccioná una agencia',''));
      (data||[]).forEach(a=>sel.add(new Option(a.nombre,a.id)));
    });
    if (sb) cargarVuelos();
    const selectorAgencia = document.getElementById('nicusa-agencia-admin');
    if (selectorAgencia) {
      selectorAgencia.addEventListener('change', () => cargarTarifas(selectorAgencia.value));
    } else if (sb) {
      sb.auth.getUser().then(async ({data,error}) => {
        if (error || !data?.user) { if (estadoTarifa) estadoTarifa.textContent = 'Sesión no disponible.'; return; }
        const {data:perfil,error:err} = await sb.from('perfiles').select('agencia_id,activo').eq('id',data.user.id).single();
        if (err || !perfil?.activo || !perfil.agencia_id) {
          if (estadoTarifa) estadoTarifa.textContent = 'No se pudo identificar la agencia.';
          return;
        }
        cargarTarifas(perfil.agencia_id);
      });
    }
    grupo.addEventListener("change", renderizar);
    renderizar();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
