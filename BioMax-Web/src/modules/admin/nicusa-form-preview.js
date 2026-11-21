// BioMax NIC → USA · V7: registro real sujeto a migración y tarifas publicadas.
// Categorías ilustrativas; no calcular cobros hasta disponer de tarifario autorizado.
(function () {
  const catalogo = {
    general: { nombre: "Carga general", unidad: "lbs" },
    medicamentos: { nombre: "Medicamentos", unidad: "lbs" },
    documentos: { nombre: "Documentos legales", unidad: "unidades" },
    pasaportes: { nombre: "Pasaportes", unidad: "unidades" },
    inyectables: { nombre: "Inyectables", unidad: "unidades" },
    retorno: { nombre: "Retorno con etiqueta prepagada", unidad: "lbs" },
    insulina: { nombre: "Insulina y derivados", unidad: "unidades" },
    termico: { nombre: "Empaque térmico", unidad: "unidades" },
    promo5: { nombre: "Combo promocional 5 lbs", unidad: "lbs" },
    promo10: { nombre: "Combo promocional 10 lbs", unidad: "lbs" },
    promo15: { nombre: "Combo promocional 15 lbs", unidad: "lbs" },
    promo20: { nombre: "Combo promocional 20 lbs", unidad: "lbs" }
  };  function iniciar() {
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
        .select('categoria,precio,unidad').eq('agencia_id',agenciaId).limit(30);
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
      recalcular(); mostrarCalculoPrevio();
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
    function mostrarCalculoPrevio() {
      const motor=window.BioMaxNICUSATarifas;
      const seleccion=[...grupo.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);
      const datos={};
      for(const cat of seleccion) {
        const input=document.getElementById('nicusa-carga-'+cat);
        if(!input || !input.value.trim())return;
        const n=Number(input.value.trim().replace(',','.'));
        if(!Number.isFinite(n)||n<=0)return;
        if(cat.startsWith('promo')) { if(datos.promo) throw Error('Solo un combo por declaración'); if(n!==1) throw Error('Seleccioná una unidad de combo'); datos.promo=cat; }
        else datos[cat]=n;
      }
            if(!motor || !seleccion.length)return;

      const target=document.getElementById('nicusa-calc-preview');

      if(!agenciaTarifada) {
        if(target) target.textContent=
          'Seleccioná una agencia para consultar las tarifas.';
        return;
      }

      if((datos.medicamentos || 0) > 2) {
        if(target) target.textContent=
          'ATENCIÓN: El máximo permitido es 2.00 lbs reales de medicamentos por declaración. ' +
          'Este envío requiere autorización especial de ViewMax.';
        return;
      }
      try {
        const beneficio=document.getElementById('nicusa-beneficio')?.value || 'ninguno';
        datos.beneficio=beneficio;
        const tarifasActuales={};
        for(const [categoria,registro] of Object.entries(tarifas)) {
          if(Number.isFinite(Number(registro.precio)) && Number(registro.precio)>=0) tarifasActuales[categoria]=Number(registro.precio);
        }
        const precio=motor.calcularNICUSA(datos,tarifasActuales);
        const target=document.getElementById('nicusa-calc-preview');
        if(target)target.textContent='Simulación (tarifas de agencia disponibles): US$'+precio.importe.toFixed(2)+' · Peso real '+precio.pesoReal.toFixed(2)+' lbs · Peso facturable '+precio.pesoFacturable.toFixed(2)+' lbs. No representa aún el cobro de Supabase.';
      } catch(e) {
        const target=document.getElementById('nicusa-calc-preview');
        if(target)target.textContent='Validación: '+e.message;
      }
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
        label.textContent = dato.nombre + (dato.unidad === "lbs" ? " · peso real (lbs)" : dato.unidad === "unidades" ? " · cantidad de unidades" : " · pendiente de definir unidad");
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
          input.value = valores[categoria] || (categoria.startsWith("promo") ? "1" : "");
          input.addEventListener("input", () => { recalcular(); mostrarCalculoPrevio(); });
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
      mostrarCalculoPrevio();
    }
    const contenedorVista=document.createElement('div');
    contenedorVista.style.cssText='margin:12px 0;padding:12px;border:1px solid #dbe3ed;border-radius:12px';
    contenedorVista.innerHTML='<label class="form-label" for="nicusa-beneficio">Beneficio incluido en promoción</label><select class="form-input" id="nicusa-beneficio"><option value="ninguno">Sin beneficio</option><option value="medicamentos">Medicamentos incluidos</option><option value="documentos">1 documento legal</option><option value="pasaportes">1 pasaporte (no aplica al combo 5 lbs)</option></select><p id="nicusa-calc-preview" role="status" style="margin-top:8px;font-weight:600">Seleccioná categorías y cantidades para simular el cobro.</p>';
    detalle.insertAdjacentElement('afterend',contenedorVista);
    contenedorVista.querySelector('select').addEventListener('change',mostrarCalculoPrevio);
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
      // Evitar registrar una declaración con importe incorrecto hasta habilitar reglas en la base de datos.
      const nuevas = checks.filter(c => !['general','medicamentos','documentos'].includes(c.value));
      if (nuevas.length) {
        aviso.textContent = 'Estas categorías ya aparecen en el catálogo, pero todavía requieren activar su cálculo y validación en Supabase antes de registrar el envío.';
        return;
      }
      const categorias={};
      for(const check of checks) {
        const value=document.getElementById('nicusa-carga-'+check.value)?.value.trim();
        if(!value || !/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value)) { aviso.textContent='Ingresá un peso o cantidad válido por categoría.';return; }
        const num=Number(value.replace(',','.'));
        if(!(num>0) || (check.value==='documentos'&&!Number.isInteger(num))) { aviso.textContent='Revisá los pesos y las unidades de documentos.';return; }
        categorias[check.value]=num;
      }      // Validar máximo de medicamentos por declaración.
      if ((categorias.medicamentos || 0) > 2) {
        aviso.textContent =
          'ATENCIÓN: El máximo permitido es 2.00 lbs reales de medicamentos por declaración. ' +
          'Este envío requiere autorización especial de ViewMax.';
        return;
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
      const confirmacion = document.getElementById('nicusa-confirmacion');
      if (confirmacion) confirmacion.hidden = true;
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
        const confirmacion = document.getElementById('nicusa-confirmacion');
        if (confirmacion) {
          confirmacion.textContent = '✓ ENVÍO REGISTRADO CORRECTAMENTE · Referencia: '+data.id.slice(0,8).toUpperCase()+' · Importe: US$'+Number(data.importe_agencia).toFixed(2)+'. Podés consultarlo en el historial de esta misma página.';
          confirmacion.hidden = false;
          confirmacion.scrollIntoView({behavior:'smooth',block:'center'});
        }
        window.dispatchEvent(new CustomEvent('biomax:nicusa-registrado'));
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
