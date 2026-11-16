/* BioMax NIC-USA: historial de solo lectura; usa RLS y limita resultados. */
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
      if(r.foto_ruta){const b=document.createElement('button');b.type='button';b.className='btn-secondary';b.textContent='Ver fotografía privada';b.addEventListener('click',async()=>{b.disabled=true;try{const {data,error}=await sb.storage.from('nicusa-fotos').createSignedUrl(r.foto_ruta,60);if(error)throw error;window.open(data.signedUrl,'_blank','noopener,noreferrer');}catch(e){estado.textContent='No se pudo abrir la foto: '+e.message;}finally{b.disabled=false;}});detalle.append(b);}
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
        ventana.document.close();ventana.focus();ventana.print();
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
