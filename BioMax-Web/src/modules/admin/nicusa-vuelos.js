/* BioMax · Gestión de fechas de vuelo NIC→USA en ViewMax. Requiere políticas RLS de administración en Supabase. */
(() => {
  const $ = id => document.getElementById(id);
  const state = message => { const el=$('nicusa-vuelos-estado'); if(el) el.textContent=message; };
  async function adminClient() {
    const sb=window.supabase;
    if(!sb) throw new Error('No hay conexión con Supabase.');
    const {data:{user},error:authError}=await sb.auth.getUser();
    if(authError||!user) throw new Error('Iniciá sesión.');
    const {data:profile,error}=await sb.from('perfiles').select('rol,activo').eq('id',user.id).single();
    if(error||!profile?.activo||profile.rol!=='admin') throw new Error('Se requiere acceso administrativo autorizado.');
    return sb;
  }
  async function listar() {
    try {
      const sb=await adminClient();
      const {data,error}=await sb.from('nicusa_vuelos').select('id,fecha,publicado').order('fecha',{ascending:false}).limit(100);
      if(error) throw error;
      const body=$('nicusa-vuelos-lista'); body.replaceChildren();
      for(const vuelo of data||[]) {
        const tr=body.insertRow();
        tr.insertCell().textContent=vuelo.fecha;
        tr.insertCell().textContent=vuelo.publicado?'Publicado':'No publicado';
        const action=tr.insertCell(), button=document.createElement('button');
        button.type='button';button.className='btn-secondary';
        button.textContent=vuelo.publicado?'Despublicar':'Publicar';
        button.addEventListener('click',async()=>{
          button.disabled=true;
          try {
            const {error:updateError}=await sb.from('nicusa_vuelos').update({publicado:!vuelo.publicado}).eq('id',vuelo.id);
            if(updateError) throw updateError;
            state('Vuelo actualizado.');await listar();
          } catch(e){state('No se pudo actualizar el vuelo: '+e.message);button.disabled=false;}
        });action.append(button);
      }
      state((data||[]).length+' vuelo(s) configurado(s). Publicá uno para habilitarlo en el formulario.');
    } catch(e){state('No se pudieron cargar los vuelos: '+e.message);}
  }
  async function crear() {
    const fecha=$('nicusa-vuelos-fecha').value;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)){state('Seleccioná una fecha válida.');return;}
    const button=$('nicusa-vuelos-crear');button.disabled=true;
    try {
      const sb=await adminClient();
      const {data:existing,error:checkError}=await sb.from('nicusa_vuelos').select('id').eq('fecha',fecha).limit(1);
      if(checkError) throw checkError;
      if(existing?.length){state('Ya existe un vuelo para esa fecha.');return;}
      const {error}=await sb.from('nicusa_vuelos').insert({fecha,publicado:false});
      if(error) throw error;
      state('Vuelo creado como no publicado. Publicalo cuando esté listo.');
      await listar();
    } catch(e){state('No se pudo crear el vuelo: '+e.message);}
    finally{button.disabled=false;}
  }
  function init(){if(!$('nicusa-vuelos-crear'))return;$('nicusa-vuelos-crear').addEventListener('click',crear);$('nicusa-vuelos-recargar').addEventListener('click',listar);listar();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
