// BioMax NIC → USA · Formulario agencia: simulación compartida con SuperAdmin y registro sujeto a validación del servidor.
// Simulación con motor de tarifas. El registro conserva validaciones del backend V7.
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
    promo5: { nombre: "Combo promocional 5 lbs", unidad: "unidades" },
    promo10: { nombre: "Combo promocional 10 lbs", unidad: "unidades" },
    promo15: { nombre: "Combo promocional 15 lbs", unidad: "unidades" },
    promo20: { nombre: "Combo promocional 20 lbs", unidad: "unidades" }
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
        if (estadoTarifa) estadoTarifa.textContent = 'No se ha identificado la agencia de tu sesión.';
        recalcular(); return;
      }
      const sb = obtenerSupabase();
      if (!sb) { if (estadoTarifa) estadoTarifa.textContent = 'Esperando conexión de la agencia…'; return; }
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
        ? 'Tarifas vigentes de tu agencia.'
        : 'Tu agencia todavía no tiene tarifas configuradas.';
      recalcular(); mostrarCalculoPrevio();
    }
    const redondear = n => Math.ceil(n * 2 - 1e-9) / 2;
    const seleccion = () => [...grupo.querySelectorAll('input[type="checkbox"]:checked')].map(e => e.value);
    const mensaje = () => document.getElementById('nicusa-calc-preview');
    function obtenerDatos() {
      const elegidas = seleccion();
      const datos = {};
      let promociones = 0;
      for (const cat of elegidas) {
        const input = document.getElementById('nicusa-carga-' + cat);
        if (!input || !input.value.trim()) throw Error('Ingresá la cantidad o peso de ' + catalogo[cat].nombre + '.');
        const texto = input.value.trim();
        if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(texto)) throw Error('Valor inválido en ' + catalogo[cat].nombre + '.');
        const n = Number(texto.replace(',', '.'));
        if (!Number.isFinite(n) || n <= 0) throw Error('Ingresá un valor mayor que cero.');
        if (catalogo[cat].unidad === 'unidades' && !Number.isInteger(n)) throw Error('La cantidad debe ser entera: ' + catalogo[cat].nombre + '.');
        if (cat.startsWith('promo')) {
          promociones++;
          if (promociones > 1) throw Error('Solo se permite un combo promocional por declaración.');
          if (n !== 1) throw Error('Seleccioná una unidad del combo promocional.');
          datos.promo = cat;
        } else datos[cat] = n;
      }
      datos.beneficio = document.getElementById('nicusa-beneficio')?.value || 'ninguno';
      if (!datos.promo && datos.beneficio !== 'ninguno') throw Error('El beneficio incluido solo aplica con un combo promocional.');
      if (datos.promo) {
        const fisico = document.getElementById('nicusa-peso-fisico-promo');
        const valor = fisico?.value.trim() || '';
        if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(valor)) throw Error('Ingresá el peso físico real total del paquete promocional.');
        const pesoFisico = Number(valor.replace(',', '.'));
        if (!(pesoFisico > 0)) throw Error('El peso físico debe ser mayor que cero.');
        const categoriasPesadas = (datos.general || 0) + (datos.medicamentos || 0) + (datos.retorno || 0);
        if (pesoFisico + 1e-8 < categoriasPesadas) throw Error('El peso físico total no puede ser menor que la suma de los pesos declarados por categoría.');
        datos.pesoFisicoPromo = pesoFisico;
      }
      return datos;
    }
    function preciosActuales() {
      const precios = {};
      for (const [cat, registro] of Object.entries(tarifas)) {
        if (Number.isFinite(Number(registro.precio)) && Number(registro.precio) >= 0) precios[cat] = Number(registro.precio);
      }
      return precios;
    }
    function recalcular() { mostrarCalculoPrevio(); }
    function mostrarCalculoPrevio() {
      const target = mensaje();
      const elegidas = seleccion();
      const motor = window.BioMaxNICUSATarifas;
      if (importe) importe.textContent = '—';
      real.textContent = '—';
      facturable.textContent = '—';
      detalle.querySelectorAll('output[id^="nicusa-calc-"]').forEach(el => { el.textContent = 'Incluido en la simulación general'; });
      if (!elegidas.length) { if (target) target.textContent = 'Seleccioná una o más categorías.'; return; }
      if (!agenciaTarifada) { if (target) target.textContent = 'Esperando las tarifas de tu agencia.'; return; }
      if (!motor || typeof motor.calcularNICUSA !== 'function') {
        if (target) target.textContent = 'No está cargado nicusa-tarifas.js. Revisá que se incluya antes de nicusa-form-preview.js.';
        return;
      }
      try {
        const datos = obtenerDatos();
        if ((datos.medicamentos || 0) > 2) throw Error('Medicamentos: máximo 2.00 lbs reales por declaración; requiere autorización especial de ViewMax.');
        const precio = motor.calcularNICUSA(datos, preciosActuales());
        real.textContent = precio.pesoReal.toFixed(2) + ' lbs';
        facturable.textContent = precio.pesoFacturable.toFixed(2) + ' lbs';
        if (importe) importe.textContent = dinero(precio.importe);
        const soloGeneral = elegidas.length === 1 && elegidas[0] === 'general';
        const pesoGeneralRedondeado = soloGeneral ? redondear(datos.general) : 0;
        const minimoAplicado = soloGeneral && precio.pesoFacturable > pesoGeneralRedondeado + 1e-8;
        const explicacionFacturable = minimoAplicado
          ? ' · Se aplica el mínimo de facturación de ' + precio.pesoFacturable.toFixed(2) + ' lbs; el peso redondeado sigue siendo ' + pesoGeneralRedondeado.toFixed(2) + ' lbs.'
          : '';
        if (target) target.textContent = 'SIMULACIÓN: ' + dinero(precio.importe) +
          ' · Peso real: ' + precio.pesoReal.toFixed(2) + ' lbs · Peso facturable: ' + precio.pesoFacturable.toFixed(2) +
          ' lbs. ' + precio.lineas.map(l => l.concepto + ': ' + dinero(l.importe)).join(' · ') +
          explicacionFacturable + ' El cobro definitivo se valida en Supabase al registrar.';
        for (const cat of elegidas) {
          const out = document.getElementById('nicusa-calc-' + cat);
          if (!out) continue;
          if (cat.startsWith('promo')) out.textContent = '1 combo · precio fijo: ' + dinero(preciosActuales()[cat] ?? motor.TARIFAS[cat]) + ' · peso real indicado por separado';
          else if (cat === 'general' || cat === 'medicamentos') {
            const n = datos[cat] || 0;
            out.textContent = n.toFixed(2) + ' lbs reales · ' + redondear(n).toFixed(2) +
              ' lbs tras redondeo por categoría' +
              (cat === 'general' && minimoAplicado ? ' · Mínimo facturable aplicado: ' + precio.pesoFacturable.toFixed(2) + ' lbs' : ' · Consultá el peso facturable total abajo');
          } else out.textContent = 'Cantidad: ' + datos[cat] + ' · ver simulación total';
        }
      } catch (e) {
        if (target) target.textContent = 'Validación: ' + e.message;
      }
    }
    function renderizar() {
      const seleccionadas = [...grupo.querySelectorAll('input[type="checkbox"]:checked')].map(e => e.value);
      detalle.replaceChildren();
      const promos = seleccionadas.filter(c => c.startsWith('promo'));
      const beneficioSelector = document.getElementById('nicusa-beneficio');
      if (beneficioSelector) {
        beneficioSelector.disabled = promos.length === 0;
        if (!promos.length) beneficioSelector.value = 'ninguno';
        const pasaporte = beneficioSelector.querySelector('option[value="pasaportes"]');
        if (pasaporte) pasaporte.disabled = promos.includes('promo5');
        if (promos.includes('promo5') && beneficioSelector.value === 'pasaportes') beneficioSelector.value = 'ninguno';
      }
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
      if (promos.length) {
        const filaPeso = document.createElement('div');
        filaPeso.className = 'form-field';
        filaPeso.style.cssText = 'border:1px solid #dbe3ed;border-radius:12px;padding:12px;';
        const etiqueta = document.createElement('label');
        etiqueta.className = 'form-label';
        etiqueta.htmlFor = 'nicusa-peso-fisico-promo';
        etiqueta.textContent = 'Peso físico REAL total del paquete promocional (lbs) *';
        const inputPeso = document.createElement('input');
        inputPeso.className = 'form-input';
        inputPeso.id = 'nicusa-peso-fisico-promo';
        inputPeso.type = 'text';
        inputPeso.inputMode = 'decimal';
        inputPeso.pattern = '[0-9]+([.,][0-9]+)?';
        inputPeso.placeholder = 'Ej. 4.74 (no son las 5 lbs del combo)';
        inputPeso.required = true;
        inputPeso.value = valores.pesoFisicoPromo || '';
        inputPeso.addEventListener('input', () => { valores.pesoFisicoPromo = inputPeso.value; mostrarCalculoPrevio(); });
        filaPeso.append(etiqueta, inputPeso);
        detalle.appendChild(filaPeso);
      }
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
    // El dashboard carga como módulo ES: Supabase puede inicializarse después de este script defer.
    // Consultar el cliente al usarlo evita capturar undefined al inicio.
    const obtenerSupabase = () => window.supabase;
    // La agencia proviene del panel autenticado, no de un selector de SuperAdmin.
    function agenciaSesion() { return String(window.biomaxAgenciaActual?.id || ''); }
    async function sincronizarAgencia() {
      const id = agenciaSesion();
      if (id && id !== agenciaTarifada) await cargarTarifas(id);
      return id;
    }
    window.addEventListener('biomax:agencia-lista', () => {
      sincronizarAgencia().catch(e => { if (estadoTarifa) estadoTarifa.textContent = 'No se pudieron cargar tarifas: ' + e.message; });
      cargarVuelos().catch(e => { if (aviso) aviso.textContent = 'No se pudieron cargar vuelos: ' + e.message; });
    });
    if (agenciaSesion()) sincronizarAgencia();
    async function cargarVuelos() {
      if (vuelo) vuelo.disabled = true;
      if (boton) boton.disabled = true;
      const sb = obtenerSupabase();
      if (!sb) { if (aviso) aviso.textContent = 'Esperando conexión de la agencia…'; return; }
      const {data,error} = await sb.from('nicusa_vuelos').select('id,fecha').eq('publicado',true).gte('fecha',new Date().toISOString().slice(0,10)).order('fecha').limit(30);
      if(error) { aviso.textContent = 'No se pudieron consultar los vuelos: ' + error.message; return; }
      vuelo.replaceChildren(new Option('Seleccioná un vuelo',''));
      (data||[]).forEach(v=>vuelo.add(new Option(v.fecha,v.id)));
      vuelo.disabled = !(data||[]).length;
      if(boton) boton.disabled = !(data||[]).length;
      aviso.textContent = (data||[]).length ? 'Seleccioná el vuelo y completá todos los campos.' : 'No hay vuelos publicados. Contactá al SuperAdmin.';
    }

    // Agenda NIC-USA: sugerencias privadas, sin seleccionar automáticamente.
    function iniciarAgendaDestinatarios() {
      const nombre = document.getElementById('nicusa-dest-nombre');
      const telefono = document.getElementById('nicusa-dest-tel');
      if (!nombre || !telefono) return;
      const lista = document.createElement('div');
      lista.id = 'nicusa-destinatarios-sugerencias';
      lista.setAttribute('role', 'listbox');
      lista.setAttribute('aria-label', 'Destinatarios guardados de tu agencia');
      lista.style.cssText = 'margin-top:8px;display:none;border:1px solid #cbd5e1;border-radius:10px;background:#fff;max-height:260px;overflow:auto;';
      telefono.closest('.form-field')?.append(lista);
      let secuencia = 0;
      let espera;
      let completando = false;
      function ocultar() { lista.replaceChildren(); lista.style.display = 'none'; }
      function completar(c) {
        // Invalidar consultas pendientes y evitar que el autollenado reactive sugerencias.
        secuencia++;
        clearTimeout(espera);
        completando = true;
        const campos = {
          'nicusa-dest-nombre': c.nombre,
          'nicusa-dest-tel': c.telefono,
          'nicusa-calle': c.calle,
          'nicusa-apto': c.apartamento,
          'nicusa-ciudad': c.ciudad,
          'nicusa-estado': c.estado,
          'nicusa-zip': c.zip
        };
        for (const [id, valor] of Object.entries(campos)) {
          const el = document.getElementById(id);
          if (el) {
            el.value = valor || '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        ocultar();
        completando = false;
      }
      async function buscar() {
        const solicitud = ++secuencia;
        const qNombre = nombre.value.trim();
        const qTelefono = telefono.value.trim();
        if (Math.max(qNombre.length, qTelefono.length) < 3) { ocultar(); return; }
        const sb = obtenerSupabase();
        const agenciaId = agenciaSesion();
        if (!sb || !agenciaId) { ocultar(); return; }
        // RLS en Supabase restringe también la lectura por agencia.
        const { data, error } = await sb.from('nicusa_destinatarios_agencia')
          .select('id,nombre,telefono,calle,apartamento,ciudad,estado,zip')
          .eq('agencia_id', agenciaId)
          .order('ultimo_uso_en', { ascending: false })
          .limit(100);
        if (solicitud !== secuencia) return;
        if (error) { console.error('BioMax agenda: consulta fallida', error); ocultar(); return; }
        const normalizar = v => String(v || '').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const digitos = v => String(v || '').replace(/\D/g, '');
        const resultados = (data || []).filter(c =>
          (qNombre.length >= 3 && normalizar(c.nombre).includes(normalizar(qNombre))) ||
          (digitos(qTelefono).length >= 3 && digitos(c.telefono).includes(digitos(qTelefono)))
        ).slice(0, 8);
        ocultar();
        for (const c of resultados) {
          const opcion = document.createElement('button');
          opcion.type = 'button';
          opcion.setAttribute('role', 'option');
          opcion.style.cssText = 'display:block;width:100%;text-align:left;padding:10px;border:0;border-bottom:1px solid #e2e8f0;background:#fff;cursor:pointer;white-space:normal';
          opcion.textContent = `${c.nombre} · ${c.telefono} · ${[c.calle,c.apartamento,c.ciudad,c.estado,c.zip].filter(Boolean).join(', ')}`;
          opcion.addEventListener('click', () => completar(c));
          lista.append(opcion);
        }
        lista.style.display = resultados.length ? 'block' : 'none';
      }
      function programar() {
        if (completando) return;
        // Invalidar inmediatamente resultados de consultas anteriores.
        secuencia++;
        clearTimeout(espera);
        ocultar();
        espera = setTimeout(buscar, 250);
      }
      nombre.addEventListener('input', programar);
      telefono.addEventListener('input', programar);
      form?.addEventListener('reset', () => { secuencia++; ocultar(); });
    }
    iniciarAgendaDestinatarios();

    // Hasta cinco fotos por declaración, sin alterar el formulario HTML existente.
    const selectorFotos = document.getElementById('nicusa-foto');
    if (selectorFotos) {
      selectorFotos.multiple = true;
      selectorFotos.accept = 'image/jpeg,image/png,image/webp';
      const nota = document.createElement('small');
      nota.textContent = 'Seleccioná de 1 a 5 fotografías (JPG, PNG o WebP; máximo 5 MB cada una).';
      nota.style.cssText = 'display:block;margin-top:6px;color:#475569';
      selectorFotos.insertAdjacentElement('afterend', nota);
    }
    const validarFotos = () => {
      const fotos = Array.from(selectorFotos?.files || []);
      if (fotos.length < 1 || fotos.length > 5) throw new Error('Seleccioná entre 1 y 5 fotografías.');
      if (fotos.some(f => !['image/jpeg','image/png','image/webp'].includes(f.type) || f.size > 5242880))
        throw new Error('Cada fotografía debe ser JPG, PNG o WebP y pesar máximo 5 MB.');
      return fotos;
    };
    const subirFoto = async (sb, agenciaId, foto) => {
      const extension = foto.type === 'image/png' ? 'png' : foto.type === 'image/webp' ? 'webp' : 'jpg';
      const ruta = agenciaId + '/' + crypto.randomUUID() + '.' + extension;
      const {error} = await sb.storage.from('nicusa-fotos').upload(ruta, foto, {contentType:foto.type,upsert:false});
      if (error) throw error;
      return ruta;
    };
    form?.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!form.reportValidity()) return;
      const checks=[...grupo.querySelectorAll('input[type="checkbox"]:checked')];
      if(!checks.length || checks.some(c=>c.value==='otros')) { aviso.textContent='Seleccioná una categoría habilitada.';return; }
      // Las 12 categorías se validan contra el tarifario de la agencia y el servidor.
      const categorias={};
      for(const check of checks) {
        const value=document.getElementById('nicusa-carga-'+check.value)?.value.trim();
        if(!value || !/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value)) { aviso.textContent='Ingresá un peso o cantidad válido por categoría.';return; }
        const num=Number(value.replace(',','.'));
        if(!(num>0) || (!['general','medicamentos','retorno'].includes(check.value)&&!Number.isInteger(num))) { aviso.textContent='Revisá los pesos y las unidades de documentos.';return; }
        categorias[check.value]=num;
      }
      // Validar máximo de medicamentos por declaración.
      if ((categorias.medicamentos || 0) > 2) {
        aviso.textContent =
          'ATENCIÓN: El máximo permitido es 2.00 lbs reales de medicamentos por declaración. ' +
          'Este envío requiere autorización especial de ViewMax.';
        return;
      }
      const agenciaSeleccionada = agenciaSesion();
      if (!agenciaSeleccionada || agenciaSeleccionada !== agenciaTarifada ||
          checks.some(c => !tarifas[c.value] || tarifas[c.value].unidad !== (['general','medicamentos','retorno'].includes(c.value) ? 'lb' : 'unidad'))) {
        aviso.textContent = 'No se puede registrar sin las tarifas vigentes de la agencia. Revisá el tarifario.';
        return;
      }
      const promoSeleccionada=checks.find(c=>c.value.startsWith('promo'))?.value;
      if(promoSeleccionada){
        const beneficio=document.getElementById('nicusa-beneficio')?.value||'ninguno';
        const fisico=document.getElementById('nicusa-peso-fisico-promo')?.value?.trim().replace(',','.');
        if(!fisico||!Number.isFinite(Number(fisico))||Number(fisico)<=0){aviso.textContent='Ingresá peso físico válido del combo.';return;}
        categorias._beneficio=beneficio;
        categorias._peso_fisico=Number(fisico);
      }
      try {
        const motor=window.BioMaxNICUSATarifas;
        if(!motor?.calcularNICUSA)throw Error('Motor de tarifas no disponible');
        const datos={...categorias,promo:promoSeleccionada||null,beneficio:categorias._beneficio||'ninguno',pesoFisicoPromo:categorias._peso_fisico};
        motor.calcularNICUSA(datos,preciosActuales());
      }catch(e){aviso.textContent='Validación: '+e.message;return;}
      let fotos;
      try { fotos = validarFotos(); } catch (e) { aviso.textContent = e.message; return; }
      if(boton) boton.disabled=true;
      aviso.textContent='Registrando envío…';
      const confirmacion = document.getElementById('nicusa-confirmacion');
      if (confirmacion) confirmacion.hidden = true;
      try {
        const sb = obtenerSupabase();
        if (!sb) throw new Error('La conexión todavía no está disponible. Volvé a intentar.');
        const {data:{user},error:authError}=await sb.auth.getUser();
        if(authError || !user) throw new Error('Sesión no válida');
        // El panel de agencia ya vinculó esta sesión con su agencia.
        // Supabase RLS debe validar en el servidor que el usuario puede insertar aquí.
        const agenciaId = agenciaSesion();
        if (!agenciaId || agenciaId !== agenciaTarifada) throw new Error('No se identificó tu agencia o sus tarifas');
        const ruta = await subirFoto(sb, agenciaId, fotos[0]);
        const campo=id=>document.getElementById('nicusa-'+id)?.value.trim()||'';
        const envio={agencia_id:agenciaId,vuelo_id:vuelo.value,remitente:campo('remitente'),remitente_telefono:campo('remitente-tel'),destinatario:campo('dest-nombre'),destinatario_telefono:campo('dest-tel'),calle:campo('calle'),apartamento:campo('apto'),ciudad:campo('ciudad'),estado:campo('estado'),zip:campo('zip'),categorias,inventario:campo('inventario'),observaciones:campo('notas'),foto_ruta:ruta};
        const {data,error}=await sb.from('nicusa_envios').insert(envio).select('id,importe_agencia').single();
        if(error) throw error;
        // La declaración ya existe: cualquier fallo posterior se informa sin duplicarla.
        const erroresFotos = [];
        for (let i = 1; i < fotos.length; i++) {
          try {
            const rutaAdicional = await subirFoto(sb, agenciaId, fotos[i]);
            const {error:anexoError} = await sb.rpc('nicusa_anexar_foto', {p_envio_id:data.id, p_ruta:rutaAdicional});
            if (anexoError) throw anexoError;
          } catch (e) { erroresFotos.push('Foto ' + (i+1) + ': ' + e.message); }
        }
        if (erroresFotos.length) {
          aviso.textContent = 'Declaración registrada con referencia ' + data.id.slice(0,8).toUpperCase() +
            ', pero algunas fotografías no se vincularon: ' + erroresFotos.join(' · ') +
            '. NO volvas a registrar el envío. Contactá a SuperAdmin para anexarlas.';
          if (boton) boton.disabled = true;
          window.dispatchEvent(new CustomEvent('biomax:nicusa-registrado'));
          return;
        }
        aviso.textContent='Envío registrado correctamente. Referencia: '+data.id.slice(0,8)+' · Importe: US$'+Number(data.importe_agencia).toFixed(2);
        const confirmacion = document.getElementById('nicusa-confirmacion');
        if (confirmacion) {
          confirmacion.textContent = '✓ ENVÍO REGISTRADO CORRECTAMENTE · Referencia: '+data.id.slice(0,8).toUpperCase()+' · Importe: US$'+Number(data.importe_agencia).toFixed(2)+'. Podés consultarlo en el historial de esta misma página.';
          confirmacion.hidden = false;
          confirmacion.scrollIntoView({behavior:'smooth',block:'center'});
        }
        window.dispatchEvent(new CustomEvent('biomax:nicusa-registrado'));
        form.reset(); Object.keys(valores).forEach(k => delete valores[k]); renderizar();
      } catch(e) { aviso.textContent='No se pudo registrar: '+e.message; }
      finally { if(boton) boton.disabled = !vuelo?.value || vuelo.disabled; }
    });
    if (obtenerSupabase()) cargarVuelos();
    // Si el panel terminó de autenticar antes que este módulo, sincronizar ahora.
    if (agenciaSesion()) sincronizarAgencia();
    grupo.addEventListener('input', event => {
      if (event.target?.matches('input[id^="nicusa-carga-"]')) valores[event.target.dataset.categoria] = event.target.value;
    });
    grupo.addEventListener("change", renderizar);
    renderizar();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
