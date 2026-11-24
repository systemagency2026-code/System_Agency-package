/* BioMax NIC-USA: historial con edición administrativa controlada; usa RLS. */
(() => {
  async function iniciar() {
    const tabla = document.querySelector('#nicusa-hist-tabla tbody');
    const estado = document.getElementById('nicusa-hist-estado');
    if (!tabla || !estado) return;
    const sb = window.supabase;
    const busqueda = document.getElementById('nicusa-hist-buscar');
    const vueloFiltro = document.getElementById('nicusa-hist-vuelo');
    const agenciaFiltro = document.getElementById('nicusa-hist-agencia');
    const detalle = document.getElementById('nicusa-hist-detalle');
    const csv = document.getElementById('nicusa-hist-csv');
    let registros = [], agencias = new Map(), logosAgencias = new Map(), vuelos = new Map(), admin = false;
    const money = v => 'US$' + Number(v || 0).toFixed(2);
    const peso = v => v == null ? '—' : Number(v).toFixed(2) + ' lbs';
    const celda = (tr, value) => { const td = tr.insertCell(); td.textContent = String(value ?? '—'); td.style.cssText='padding:10px;border-bottom:1px solid #e2e8f0;white-space:nowrap'; return td; };
    const ref = r => r.id.slice(0,8).toUpperCase();
    const visibles = () => registros.filter(r => {
      const q = busqueda.value.trim().toLocaleLowerCase();
      return (!q || [r.id,r.destinatario,r.remitente].some(v=>String(v||'').toLocaleLowerCase().includes(q)))
        && (!vueloFiltro.value || r.vuelo_id===vueloFiltro.value)
        && (!agenciaFiltro || !agenciaFiltro.value || r.agencia_id===agenciaFiltro.value);
    });
    function mostrarDetalle(r) {
      detalle.replaceChildren(); detalle.hidden=false;
      const h=document.createElement('h4');h.textContent='Detalle del envío '+ref(r);detalle.append(h);
      const campos=[['Referencia completa',r.id],['Agencia',agencias.get(r.agencia_id)||r.agencia_id],['Vuelo',vuelos.get(r.vuelo_id)||r.vuelo_id],['Remitente',r.remitente],['Teléfono remitente',r.remitente_telefono],['Destinatario',r.destinatario],['Teléfono destinatario',r.destinatario_telefono],['Dirección',[r.calle,r.apartamento,r.ciudad,r.estado,r.zip].filter(Boolean).join(', ')],['Inventario',r.inventario],['Categorías',Object.entries(r.categorias||{}).map(([k,v])=>k+': '+v).join(' · ')],['Peso real',peso(r.peso_real_agencia)],['Peso facturable',peso(r.peso_facturable)],['Importe agencia',money(r.importe_agencia)],['Observaciones',r.observaciones||'—']];
      const dl=document.createElement('dl');dl.style.cssText='display:grid;grid-template-columns:minmax(130px,200px) 1fr;gap:8px;white-space:pre-wrap;overflow-wrap:anywhere';
      for(const [k,v] of campos){const dt=document.createElement('dt');dt.textContent=k;dt.style.fontWeight='700';const dd=document.createElement('dd');dd.textContent=v??'—';dd.style.margin='0';dl.append(dt,dd);}detalle.append(dl);
       // Edición administrativa: solo datos que no alteran la liquidación calculada.
       if (admin) {
         const editar = document.createElement('button');
         editar.type = 'button'; editar.className = 'btn-secondary';
         editar.textContent = 'Editar declaración';
         editar.style.cssText = 'margin:12px 0';
         detalle.append(editar);
         editar.addEventListener('click', () => {
           if (detalle.querySelector('#nicusa-editor-admin')) return;
           const panel = document.createElement('form');
           panel.id = 'nicusa-editor-admin';
           panel.style.cssText = 'padding:16px;border:1px solid #cbd5e1;border-radius:12px;margin:12px 0;display:grid;gap:12px;max-width:720px';
           const titulo = document.createElement('h4');
           titulo.textContent = 'Editar declaración ' + ref(r);
           panel.append(titulo);
           const nota = document.createElement('p');
           nota.textContent = 'Podés corregir el vuelo y los datos de envío. Las categorías, pesos e importes se mantienen sin cambios para proteger el cálculo original.';
           panel.append(nota);
           const controles = {};
           function campo(etiqueta, clave, multilinea = false, obligatorio = true) {
             const cont = document.createElement('label');
             cont.style.cssText = 'display:grid;gap:5px;font-weight:600';
             cont.append(document.createTextNode(etiqueta));
             const input = multilinea ? document.createElement('textarea') : document.createElement('input');
             if (!multilinea) input.type = 'text';
             input.className = 'form-input';
             input.value = r[clave] || '';
             input.required = obligatorio;
             input.style.cssText = 'width:100%;box-sizing:border-box;font-weight:400';
             cont.append(input);panel.append(cont);controles[clave] = input;
           }
           const vueloLabel = document.createElement('label');
           vueloLabel.style.cssText = 'display:grid;gap:5px;font-weight:600';
           vueloLabel.textContent = 'Fecha del vuelo *';
           const vueloSelect = document.createElement('select');
           vueloSelect.className = 'form-input'; vueloSelect.required = true;
           for (const [id, fecha] of [...vuelos.entries()].sort((a,b)=>a[1].localeCompare(b[1]))) {
             vueloSelect.add(new Option(fecha, id));
           }
           if (!vuelos.has(r.vuelo_id)) vueloSelect.add(new Option('Vuelo actual (no encontrado en listado)',r.vuelo_id));
           vueloSelect.value = r.vuelo_id;
           vueloLabel.append(vueloSelect);panel.append(vueloLabel);
           campo('Remitente *','remitente');
           campo('Teléfono remitente *','remitente_telefono');
           campo('Destinatario *','destinatario');
           campo('Teléfono destinatario *','destinatario_telefono');
           campo('Calle y número *','calle');
           campo('Apartamento','apartamento',false,false);
           campo('Ciudad *','ciudad');
           campo('Estado *','estado');
           campo('ZIP *','zip');
           campo('Inventario *','inventario',true);
           campo('Observaciones','observaciones',true,false);
           const mensaje = document.createElement('p');mensaje.setAttribute('role','status');panel.append(mensaje);
           const acciones = document.createElement('div');acciones.style.cssText='display:flex;gap:10px;flex-wrap:wrap';
           const guardar = document.createElement('button');guardar.type='submit';guardar.className='btn-primary';guardar.textContent='Guardar cambios';
           const cancelar = document.createElement('button');cancelar.type='button';cancelar.className='btn-secondary';cancelar.textContent='Cancelar';
           cancelar.addEventListener('click',()=>panel.remove());
           acciones.append(guardar,cancelar);panel.append(acciones);
           editar.insertAdjacentElement('afterend',panel);
           panel.addEventListener('submit',async ev=>{
             ev.preventDefault();if(!panel.reportValidity())return;
             const cambios = {vuelo_id:vueloSelect.value};
             for (const [clave,input] of Object.entries(controles)) cambios[clave]=input.value.trim();
             if (!cambios.vuelo_id || !vuelos.has(cambios.vuelo_id)) {
               mensaje.textContent='Seleccioná un vuelo válido del listado.';return;
             }
             if (!window.confirm('¿Confirmás guardar los cambios de la declaración '+ref(r)+'?'))return;
             guardar.disabled=true;cancelar.disabled=true;mensaje.textContent='Guardando cambios…';
             try {
               const {data,error}=await sb.from('nicusa_envios').update(cambios).eq('id',r.id)
                 .select('id,vuelo_id,remitente,remitente_telefono,destinatario,destinatario_telefono,calle,apartamento,ciudad,estado,zip,inventario,observaciones').single();
               if(error)throw error;
               if(!data)throw new Error('No se confirmó la actualización. Revisá permisos RLS.');
               Object.assign(r,data);
               mensaje.textContent='Cambios guardados correctamente.';
               await cargar();
               mostrarDetalle(r);
               estado.textContent='Declaración '+ref(r)+' actualizada correctamente.';
             }catch(e){mensaje.textContent='No se pudieron guardar los cambios: '+e.message;}
             finally{guardar.disabled=false;cancelar.disabled=false;}
           });
         });
       }
       // Mostrar foto original y anexos, sin perder compatibilidad con declaraciones anteriores.
       const fotosPanel = document.createElement('section');
       const fotosTitulo = document.createElement('h4'); fotosTitulo.textContent = 'Fotografías de la declaración';
       const fotosLista = document.createElement('div');
       fotosLista.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:8px 0';
       const fotosEstado = document.createElement('p'); fotosEstado.textContent = 'Consultando fotografías…';
       fotosPanel.append(fotosTitulo, fotosLista, fotosEstado); detalle.append(fotosPanel);
       let rutasFotos = r.foto_ruta ? [r.foto_ruta] : [];
       let vigente = true;
       async function actualizarFotos() {
         fotosLista.replaceChildren();
         const {data, error} = await sb.from('nicusa_envios_fotos')
           .select('ruta,agregado_en').eq('envio_id',r.id).order('agregado_en',{ascending:true});
         if (!fotosPanel.isConnected || !vigente) return;
         if (error) { fotosEstado.textContent = 'No se pudieron consultar los anexos: ' + error.message; return; }
         rutasFotos = [...(r.foto_ruta ? [r.foto_ruta] : []), ...(data || []).map(x=>x.ruta)];
         fotosEstado.textContent = rutasFotos.length + ' de 5 fotografías.';
         rutasFotos.forEach((ruta,i) => {
           const b=document.createElement('button'); b.type='button'; b.className='btn-secondary';
           b.textContent='Ver fotografía ' + (i+1);
           b.addEventListener('click',async()=>{
             // Abrir pestaña desde el clic para evitar bloqueo de popups tras el await.
             const pestaña=window.open('','_blank');
             if (!pestaña) { fotosEstado.textContent='Permití ventanas emergentes para ver la fotografía.'; return; }
             b.disabled=true;
             try { const {data,error}=await sb.storage.from('nicusa-fotos').createSignedUrl(ruta,60);
               if(error) throw error; pestaña.location.href=data.signedUrl;
             } catch(e) { pestaña.close(); fotosEstado.textContent='No se pudo abrir la fotografía: '+e.message; }
             finally { b.disabled=false; }
           }); fotosLista.append(b);
         });
         if (admin && rutasFotos.length < 5) {
           const selector=document.createElement('input'); selector.type='file'; selector.multiple=true;
           selector.accept='image/jpeg,image/png,image/webp';
           selector.setAttribute('aria-label','Anexar fotografías a la declaración');
           const agregar=document.createElement('button'); agregar.type='button'; agregar.className='btn-secondary';
           agregar.textContent='Anexar fotografías';
           agregar.addEventListener('click',async()=>{
             const archivos=Array.from(selector.files||[]);
             if (!archivos.length || archivos.length>5-rutasFotos.length) {
               fotosEstado.textContent='Seleccioná de 1 a '+(5-rutasFotos.length)+' fotografía(s).';return;
             }
             if (archivos.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>5242880)) {
               fotosEstado.textContent='Cada fotografía debe ser JPG, PNG o WebP y máximo 5 MB.';return;
             }
             agregar.disabled=true; fotosEstado.textContent='Anexando fotografías…';
             let completadas=0;
             try {
               for (const foto of archivos) {
                 const ext=foto.type==='image/png'?'png':foto.type==='image/webp'?'webp':'jpg';
                 const ruta=r.agencia_id+'/'+crypto.randomUUID()+'.'+ext;
                 const {error:uploadError}=await sb.storage.from('nicusa-fotos').upload(ruta,foto,{contentType:foto.type,upsert:false});
                 if(uploadError) throw uploadError;
                 const {error:rpcError}=await sb.rpc('nicusa_anexar_foto',{p_envio_id:r.id,p_ruta:ruta});
                 if(rpcError) throw rpcError;
                 completadas++;
               }
               await actualizarFotos();
             } catch(e) {
               await actualizarFotos();
               fotosEstado.textContent='Se anexaron '+completadas+' fotografía(s). Error: '+e.message+
                 '. Revisá el listado antes de intentar nuevamente.';
             } finally { agregar.disabled=false; }
           });
           const zona=document.createElement('div'); zona.style.cssText='width:100%;display:flex;flex-wrap:wrap;gap:8px;align-items:center';
           zona.append(selector,agregar); fotosLista.append(zona);
         }
       }
       actualizarFotos().catch(e=>{fotosEstado.textContent='Error consultando fotografías: '+e.message;});

      // Etiqueta de 4 × 6 pulgadas: sin tarifas ni costos del transportador.
      const imprimir=document.createElement('button');
      imprimir.type='button';imprimir.className='btn-secondary';
      imprimir.textContent='Imprimir etiqueta 4 × 6 / Guardar PDF';
      imprimir.addEventListener('click',()=>{
        const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const nombreAgencia=agencias.get(r.agencia_id)||'Agencia';
        const logoRaw=logosAgencias.get(r.agencia_id)||'';
        const logoAgencia=/^https:\/\//i.test(logoRaw)?logoRaw:'';
        const ventana=window.open('','_blank','width=540,height=820');
        if(!ventana){estado.textContent='Permití ventanas emergentes para imprimir la etiqueta.';return;}
        ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiqueta ${esc(ref(r))}</title><style>
@page{size:4in 6in;margin:0}*{box-sizing:border-box}body{margin:0;color:#111;font-family:Arial,sans-serif}.etiqueta{width:4in;height:6in;padding:.22in;display:flex;flex-direction:column;border:1px solid #222}.logo-agencia{display:block;max-width:2.9in;max-height:1.15in;object-fit:contain;margin:0 auto 8px}.agencia{font-size:19pt;font-weight:800;text-align:center;border-bottom:2px solid #111;padding-bottom:9px;overflow-wrap:anywhere}.ref{text-align:center;font-size:10pt;padding:10px 0}.sub{font-size:9pt;font-weight:700;text-transform:uppercase;margin:12px 0 4px}.dest{font-size:19pt;font-weight:800;overflow-wrap:anywhere}.dir{font-size:14pt;line-height:1.3;overflow-wrap:anywhere}.zip{font-size:17pt;font-weight:800;margin-top:7px;overflow-wrap:anywhere}.peso{margin-top:15px;border-top:1px solid #222;padding-top:9px;font-size:13pt}.pie{margin-top:auto;text-align:center;border-top:1px solid #222;padding-top:9px;font-size:8pt}@media screen{body{background:#ddd;padding:12px}.etiqueta{background:#fff;margin:auto}}@media print{body{padding:0}.etiqueta{border:0}}</style></head><body><div class="etiqueta">${logoAgencia?`<img class="logo-agencia" src="${esc(logoAgencia)}" alt="Logo de ${esc(nombreAgencia)}">`:``}<div class="agencia">${esc(nombreAgencia)}</div><div class="ref">Referencia: ${esc(ref(r))}</div><div class="sub">Destinatario</div><div class="dest">${esc(r.destinatario)}</div><div class="sub">Dirección de entrega</div><div class="dir">${esc(r.calle)}${r.apartamento?'<div>'+esc(r.apartamento)+'</div>':''}</div><div class="zip">${esc([r.ciudad,r.estado,r.zip].filter(Boolean).join(', '))}</div><div class="pie">Gracias por confiar en BioMax Logistics</div></div></body></html>`);
        ventana.document.close();ventana.focus();
        const imagenLogo=ventana.document.querySelector('.logo-agencia');
        if(imagenLogo){
          if(imagenLogo.complete){
            if(imagenLogo.naturalWidth>0) ventana.print();
            else estado.textContent='El logo registrado no pudo cargarse. Revisá la URL del logo en la ficha de agencia.';
          }else{
            imagenLogo.addEventListener('load',()=>ventana.print(),{once:true});
            imagenLogo.addEventListener('error',()=>{estado.textContent='No se pudo cargar el logo de la agencia. Revisá su enlace.';},{once:true});
          }
        }else{
          estado.textContent='La agencia no tiene un logo URL válido disponible para la etiqueta.';
        }
      });
      detalle.append(imprimir);
      detalle.scrollIntoView({behavior:'smooth',block:'nearest'});
    }
    function render() {
      tabla.replaceChildren(); const rows=visibles();
      estado.textContent=rows.length+' envío(s) visible(s) de '+registros.length+' cargado(s).';csv.disabled=!rows.length;
      rows.forEach(r=>{const tr=tabla.insertRow();celda(tr,ref(r));celda(tr,vuelos.get(r.vuelo_id)||'—');if(admin)celda(tr,agencias.get(r.agencia_id)||'—');celda(tr,r.destinatario);celda(tr,peso(r.peso_real_agencia));celda(tr,peso(r.peso_facturable));celda(tr,money(r.importe_agencia));const td=tr.insertCell();const b=document.createElement('button');b.type='button';b.className='btn-secondary';b.textContent='Ver detalle';b.addEventListener('click',()=>mostrarDetalle(r));td.append(b);});
    }
    async function cargar() {
      if(!sb){estado.textContent='No hay conexión con Supabase.';return;}
      estado.textContent='Consultando envíos…';
      try{
        const {data:{user},error:ue}=await sb.auth.getUser();if(ue||!user)throw new Error('Sesión no disponible');
        const {data:perfil,error:pe}=await sb.from('perfiles').select('rol,agencia_id,activo').eq('id',user.id).single();
        if(pe||!perfil?.activo)throw new Error('Perfil no autorizado');
        admin=perfil.rol==='admin';if(!admin && (perfil.rol!=='agente'||!perfil.agencia_id))throw new Error('Acceso no autorizado');
        let query=sb.from('nicusa_envios').select('id,agencia_id,vuelo_id,remitente,remitente_telefono,destinatario,destinatario_telefono,calle,apartamento,ciudad,estado,zip,categorias,inventario,observaciones,peso_real_agencia,peso_facturable,importe_agencia,foto_ruta,creado_en').order('creado_en',{ascending:false}).limit(200);
        if(!admin)query=query.eq('agencia_id',perfil.agencia_id);
        const {data,error}=await query;if(error)throw error;registros=data||[];
        const [a,v]=await Promise.all([sb.from('agencias').select('id,nombre,logo_url').limit(100),sb.from('nicusa_vuelos').select('id,fecha').order('fecha',{ascending:false}).limit(100)]);
        if(a.error)throw a.error;if(v.error)throw v.error;
        agencias=new Map((a.data||[]).map(x=>[x.id,x.nombre]));logosAgencias=new Map((a.data||[]).map(x=>[x.id,x.logo_url||'']));vuelos=new Map((v.data||[]).map(x=>[x.id,x.fecha]));
        const selectedVuelo=vueloFiltro.value;vueloFiltro.replaceChildren(new Option('Todos los vuelos',''));for(const x of v.data||[])vueloFiltro.add(new Option(x.fecha,x.id));vueloFiltro.value=selectedVuelo;
        if(agenciaFiltro){const selected=agenciaFiltro.value;agenciaFiltro.replaceChildren(new Option('Todas las agencias',''));for(const x of a.data||[])agenciaFiltro.add(new Option(x.nombre,x.id));agenciaFiltro.value=selected;}
        render();
      }catch(e){estado.textContent='No se pudo consultar el historial: '+e.message;}
    }
    for(const input of [busqueda,vueloFiltro,agenciaFiltro].filter(Boolean))input.addEventListener(input===busqueda?'input':'change',render);
    document.getElementById('nicusa-hist-recargar').addEventListener('click',cargar);
    window.addEventListener('biomax:nicusa-registrado',cargar);
    csv.addEventListener('click',()=>{
      const cols=['Referencia','Vuelo',...(admin?['Agencia']:[]),'Remitente','Destinatario','Telefono destinatario','Direccion','Inventario','Peso real lbs','Peso facturable lbs','Importe USD'];
      const lines=[cols,...visibles().map(r=>[r.id,vuelos.get(r.vuelo_id)||'',...(admin?[agencias.get(r.agencia_id)||'']:[]),r.remitente,r.destinatario,r.destinatario_telefono,[r.calle,r.apartamento,r.ciudad,r.estado,r.zip].filter(Boolean).join(', '),r.inventario,r.peso_real_agencia,r.peso_facturable,r.importe_agencia])];
      const escaped=lines.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
      const blob=new Blob(['\ufeff'+escaped],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='biomax-nicusa-historial.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    await cargar();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar);else iniciar();
})();