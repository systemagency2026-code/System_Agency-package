
alter table public.agencias add column logo_url text;
alter table public.agencias
  add constraint ck_agencias_logo check (logo_url is null or (char_length(logo_url) <= 500 and logo_url ~ '^https://'));

create function public.crear_agencia_desde_solicitud(
  p_admin_id     uuid,
  p_solicitud_id uuid,
  p_codigo       text,
  p_nombre       text,
  p_usuario_id   uuid,
  p_logo_url     text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sol     public.solicitudes_afiliacion;
  v_agencia uuid;
begin
  perform set_config('request.jwt.claim.sub', p_admin_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_admin_id, 'role', 'authenticated')::text, true);

  if not private.es_admin() then
    raise exception 'No tienes permiso para esta operación' using errcode = '42501';
  end if;

  select * into v_sol from public.solicitudes_afiliacion where id = p_solicitud_id for update;
  if not found then
    raise exception 'La solicitud no existe';
  end if;
  if v_sol.estado <> 'pendiente' then
    raise exception 'La solicitud ya fue resuelta';
  end if;

  insert into public.agencias (codigo, nombre, correo, telefono, direccion, departamento, logo_url)
  values (upper(btrim(p_codigo)), btrim(p_nombre), v_sol.correo, v_sol.telefono, v_sol.direccion, v_sol.departamento, p_logo_url)
  returning id into v_agencia;

  insert into public.perfiles (id, agencia_id, rol, nombre)
  values (p_usuario_id, v_agencia, 'agente', v_sol.nombre_contacto);

  update public.solicitudes_afiliacion
     set estado = 'aprobada', agencia_id = v_agencia
   where id = p_solicitud_id;

  return v_agencia;
end;
$$;
revoke all on function public.crear_agencia_desde_solicitud(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.crear_agencia_desde_solicitud(uuid, uuid, text, text, uuid, text) to service_role;
