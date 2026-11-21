/* BioMax NIC-USA · reporte exclusivo para transportador. Solo usuarios admin autorizados. */
(() => {
  let tarifaTransportador = null;
  const $ = id => document.getElementById(id);
  const money = n => 'US$' + Number(n).toFixed(2);
  const num = n => Number(n ?? 0);
  const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  let filas = [], fecha = '';
  const cols = ['Agencia','Nombre y apellido más teléfono','Dirección exacta de entrega','Ciudad, estado y ZIP','Inventario de artículos en paquete','Peso Managua-Miami (lbs)','Envío US$'];
  const aviso = msg => { $('nicusa-rep-estado').textContent = msg; };
  const sbReady = () => window.supabase;
  async function verificarAdmin(sb) {
    const {data:{user},error:authError} = await sb.auth.getUser();
    if (authError || !user) throw new Error('Iniciá sesión para consultar reportes.');
    const {data:perfil,error} = await sb.from('perfiles').select('rol,activo').eq('id',user.id).single();
    if (error || !perfil?.activo || perfil.rol !== 'admin') throw new Error('Solo un administrador autorizado puede generar este reporte.');
  }
  async function vuelos() {
    const sb = sbReady(); if (!sb) return;
    try {
      await verificarAdmin(sb);
      const {data,error} = await sb.from('nicusa_vuelos').select('id,fecha').order('fecha',{ascending:false}).limit(200);
      if(error) throw error;
      const sel=$('nicusa-rep-vuelo'), previous=sel.value;
      sel.replaceChildren(new Option('Seleccioná un vuelo',''));
      for(const v of data||[]) sel.add(new Option(v.fecha,v.id));
      sel.value=previous;
    } catch(e) { aviso('No se pudieron consultar vuelos: '+e.message); }
  }
  function descargarCsv() {
    const data=[cols,...filas.map(f=>f.values),['TOTAL','','','','',filas.reduce((a,f)=>a+f.peso,0).toFixed(2),filas.reduce((a,f)=>a+f.pago,0).toFixed(2)]];
    const text='\ufeff'+data.map(r=>r.map(csvCell).join(',')).join('\r\n');
    const blob=new Blob([text],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url;a.download='biomax-transportador-nicusa-'+fecha+'.csv';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function imprimir() {
    const w=window.open('','_blank','width=1250,height=850');
    if(!w){aviso('Permití ventanas emergentes para imprimir el reporte.');return;}
    const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const heads=cols.map(c=>'<th>'+escape(c)+'</th>').join('');
    const rows=filas.map(f=>'<tr>'+f.values.map(v=>'<td>'+escape(v)+'</td>').join('')+'</tr>').join('');
    const p=filas.reduce((a,f)=>a+f.peso,0),t=filas.reduce((a,f)=>a+f.pago,0);
    w.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Transportador NIC-USA '+escape(fecha)+'</title><style>@page{size:landscape;margin:12mm}body{font:11px Arial,sans-serif}h2{margin-bottom:4px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #777;padding:6px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}td:nth-child(5){min-width:200px}</style></head><body><h2>BioMax · Reporte transportador NIC → USA</h2><p>Vuelo: '+escape(fecha)+' · Tarifa: US$'+escape(Number(tarifaTransportador).toFixed(2))+' por libra real</p><table><thead><tr>'+heads+'</tr></thead><tbody>'+rows+'</tbody><tfoot><tr><th colspan="5">TOTAL</th><th>'+p.toFixed(2)+'</th><th>'+money(t)+'</th></tr></tfoot></table></body></html>');
    w.document.close();w.focus();w.print();
  }
  async function generar() {
    const sb=sbReady(), id=$('nicusa-rep-vuelo').value;
    if(!id){aviso('Seleccioná primero una fecha de vuelo.');return;}
    $('nicusa-rep-csv').disabled=true;$('nicusa-rep-imprimir').disabled=true;
    filas=[];aviso('Consultando declaraciones del vuelo…');
    try {
      if(!sb)throw new Error('No hay conexión con Supabase.');
      await verificarAdmin(sb);
      fecha=$('nicusa-rep-vuelo').selectedOptions[0].textContent;
      const configResult = await sb.from('nicusa_configuracion').select('tarifa_transportador').limit(1).single();
      if(configResult.error) throw configResult.error;
      tarifaTransportador = Number(configResult.data?.tarifa_transportador);
      if(!Number.isFinite(tarifaTransportador) || tarifaTransportador < 0) throw new Error('Tarifa del transportador no configurada.');
      const [agenciasResult]=await Promise.all([sb.from('agencias').select('id,nombre')]);
      if(agenciasResult.error)throw agenciasResult.error;
      const agencias=new Map((agenciasResult.data||[]).map(a=>[a.id,a.nombre]));
      let registros=[];
      for(let desde=0;;desde+=500){
        const {data,error}=await sb.from('nicusa_envios').select('id,agencia_id,destinatario,destinatario_telefono,calle,apartamento,ciudad,estado,zip,inventario,peso_real_agencia').eq('vuelo_id',id).order('id',{ascending:true}).range(desde,desde+499);
        if(error)throw error;
        registros.push(...(data||[]));
        if(!data || data.length<500)break;
      }
      for(const r of registros){
        const peso=num(r.peso_real_agencia);
        if(!Number.isFinite(peso)||peso<=0)throw new Error('Peso real inválido en declaración '+r.id+'. Corregilo antes de emitir el reporte.');
        const pago=Math.round((peso*tarifaTransportador+Number.EPSILON)*100)/100;
        const values=[agencias.get(r.agencia_id)||'Agencia sin nombre', [r.destinatario,r.destinatario_telefono].filter(Boolean).join(' · '),[r.calle,r.apartamento].filter(Boolean).join(', '),[r.ciudad,r.estado,r.zip].filter(Boolean).join(', '),r.inventario||'',peso.toFixed(2),pago.toFixed(2)];
        filas.push({values,peso,pago});
      }
      const tbody=$('nicusa-rep-tabla').querySelector('tbody');tbody.replaceChildren();
      for(const f of filas){const tr=tbody.insertRow();for(const v of f.values){const td=tr.insertCell();td.textContent=v;td.style.whiteSpace='pre-wrap';td.style.verticalAlign='top';}}
      $('nicusa-rep-peso').textContent=filas.reduce((a,f)=>a+f.peso,0).toFixed(2);
      $('nicusa-rep-total').textContent=money(filas.reduce((a,f)=>a+f.pago,0));
      $('nicusa-rep-csv').disabled=!filas.length;$('nicusa-rep-imprimir').disabled=!filas.length;
      aviso(filas.length+' declaración(es) del vuelo '+fecha+'. Solo peso real y pago al transportador.');
    }catch(e){aviso('No se pudo generar el reporte: '+e.message);}
  }
  function init(){
    if(!$('nicusa-rep-generar'))return;
    $('nicusa-rep-generar').addEventListener('click',generar);
    $('nicusa-rep-csv').addEventListener('click',descargarCsv);
    $('nicusa-rep-imprimir').addEventListener('click',imprimir);
    $('nicusa-rep-vuelo').addEventListener('focus',vuelos);
    vuelos();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
