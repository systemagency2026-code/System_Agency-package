
do $$
declare
  v_admin uuid := gen_random_uuid();
  v_ua    uuid := gen_random_uuid();
  v_ub    uuid := gen_random_uuid();
  v_ag_a  uuid;
  v_ag_b  uuid;
  v_sol   uuid;
  v_n     int;
  v_ok    int := 0;
  v_fallo boolean;
  v_txt   text;
begin
  insert into auth.users (id, email) values
    (v_admin, 'admin.test@example.invalid'),
    (v_ua,    'agente.a.test@example.invalid'),
    (v_ub,    'agente.b.test@example.invalid');
  insert into public.agencias (codigo, nombre) values ('TST-A', 'Agencia Test A') returning id into v_ag_a;
  insert into public.agencias (codigo, nombre) values ('TST-B', 'Agencia Test B') returning id into v_ag_b;
  insert into public.perfiles (id, agencia_id, rol, nombre) values
    (v_admin, null,   'admin',  'Admin Test'),
    (v_ua,    v_ag_a, 'agente', 'Agente A'),
    (v_ub,    v_ag_b, 'agente', 'Agente B');

  set local role anon;

  begin perform 1 from public.agencias;
    raise exception 'FALLO: anon pudo leer agencias';
  exception when insufficient_privilege then v_ok := v_ok + 1; end;

  begin perform 1 from public.perfiles;
    raise exception 'FALLO: anon pudo leer perfiles';
  exception when insufficient_privilege then v_ok := v_ok + 1; end;

  begin perform 1 from public.auditoria;
    raise exception 'FALLO: anon pudo leer auditoria';
  exception when insufficient_privilege then v_ok := v_ok + 1; end;

  begin perform 1 from public.solicitudes_afiliacion;
    raise exception 'FALLO: anon pudo leer solicitudes de afiliacion';
  exception when insufficient_privilege then v_ok := v_ok + 1; end;

  insert into public.solicitudes_afiliacion (nombre_negocio, nombre_contacto, correo)
  values ('Negocio Test', 'Contacto Test', 'solicitud.test@example.invalid');
  v_ok := v_ok + 1;

  begin
    insert into public.solicitudes_afiliacion (nombre_negocio, nombre_contacto, correo, estado)
    values ('Otro', 'Otro Contacto', 'otro.test@example.invalid', 'aprobada');
    raise exception 'FALLO: anon pudo insertar una solicitud ya aprobada';
  exception when insufficient_privilege then v_ok := v_ok + 1; end;

  begin
    insert into public.solicitudes_afiliacion (nombre_negocio, nombre_contacto, correo)
    values ('Negocio Test', 'Contacto Test', 'SOLICITUD.test@example.invalid');
    raise exception 'FALLO: anon pudo duplicar una solicitud pendiente';
  exception when unique_violation then v_ok := v_ok + 1; end;

  begin
    insert into public.solicitudes_afiliacion (nombre_negocio, nombre_contacto, correo)
    values ('Negocio', 'Contacto', 'esto-no-es-un-correo');
    raise exception 'FALLO: se aceptó un correo inválido';
  exception when check_violation then v_ok := v_ok + 1; end;

  reset role;
  select id into v_sol from public.solicitudes_afiliacion where correo = 'solicitud.test@example.invalid';

  perform set_config('request.jwt.claim.sub', v_ua::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.agencias;
  if v_n <> 1 then raise exception 'FALLO: el agente A ve % agencias (debía ver 1)', v_n; end if;
  select count(*) into v_n from public.agencias where id = v_ag_b;
  if v_n <> 0 then raise exception 'FALLO: el agente A ve la agencia B'; end if;
  v_ok := v_ok + 1;

  select count(*) into v_n from public.perfiles;
  if v_n <> 1 then raise exception 'FALLO: el agente A ve % perfiles (debía ver 1)', v_n; end if;
  v_ok := v_ok + 1;

  select count(*) into v_n from public.auditoria;
  if v_n <> 0 then raise exception 'FALLO: el agente A ve la auditoria'; end if;
  select count(*) into v_n from public.solicitudes_afiliacion;
  if v_n <> 0 then raise exception 'FALLO: el agente A ve solicitudes de afiliacion'; end if;
  v_ok := v_ok + 1;

  begin
    insert into public.agencias (codigo, nombre) values ('HACK', 'Agencia falsa');
    raise exception 'FALLO: el agente pudo crear una agencia';
  exception when insufficient_privilege then v_ok := v_ok + 1; end;

  update public.agencias set nombre = 'Cambiado por agente' where id in (v_ag_a, v_ag_b);
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FALLO: el agente modificó % agencias', v_n; end if;
  v_ok := v_ok + 1;

  update public.perfiles set nombre = 'Hackeado';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FALLO: el agente pudo modificar perfiles (propio o ajeno)'; end if;
  v_ok := v_ok + 1;

  begin
    delete from public.agencias;
    raise exception 'FALLO: el agente pudo borrar agencias';
  exception when insufficient_privilege then v_ok := v_ok + 1; end;


  reset role;
  select rol::text into v_txt from public.perfiles where id = v_ua;
  if v_txt <> 'agente' then raise exception 'FALLO: el rol del agente A cambió'; end if;

  update public.agencias set estado = 'suspendida' where id = v_ag_a;
  set local role authenticated;
  select count(*) into v_n from public.agencias;
  if v_n <> 0 then raise exception 'FALLO: agencia suspendida pero el agente A aún ve datos'; end if;
  v_ok := v_ok + 1;
  reset role;
  update public.agencias set estado = 'activa' where id = v_ag_a;

  update public.perfiles set activo = false where id = v_ua;
  set local role authenticated;
  select count(*) into v_n from public.perfiles;
  if v_n <> 0 then raise exception 'FALLO: perfil desactivado pero el agente A aún ve datos'; end if;
  v_ok := v_ok + 1;
  reset role;
  update public.perfiles set activo = true where id = v_ua;

  -- ===== 4. Administrador =============================================
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.agencias where id in (v_ag_a, v_ag_b);
  if v_n <> 2 then raise exception 'FALLO: el admin no ve ambas agencias de prueba'; end if;
  v_ok := v_ok + 1;

  select count(*) into v_n from public.auditoria;
  if v_n = 0 then raise exception 'FALLO: el admin no ve registros de auditoria'; end if;
  v_ok := v_ok + 1;

  -- Aprobar sin agencia: rechazado por la base de datos
  begin
    update public.solicitudes_afiliacion set estado = 'aprobada' where id = v_sol;
    raise exception 'FALLO: se aprobó una solicitud sin agencia asociada';
  exception when check_violation then v_ok := v_ok + 1; end;

  -- Aprobar correctamente
  update public.solicitudes_afiliacion set estado = 'aprobada', agencia_id = v_ag_b where id = v_sol;
  select (revisada_por = v_admin and revisada_en is not null) into v_fallo
    from public.solicitudes_afiliacion where id = v_sol;
  if not v_fallo then raise exception 'FALLO: el revisor o la fecha no se registraron'; end if;
  v_ok := v_ok + 1;

  -- Una solicitud resuelta no se puede volver a modificar
  v_fallo := false;
  begin
    update public.solicitudes_afiliacion set estado = 'rechazada', motivo_rechazo = 'x', agencia_id = null where id = v_sol;
    v_fallo := true;
  exception when raise_exception then null; end;
  if v_fallo then raise exception 'FALLO: se modificó una solicitud ya resuelta'; end if;
  v_ok := v_ok + 1;

  -- Ni el admin puede editar o borrar la auditoría desde la API
  begin
    update public.auditoria set accion = 'INSERT';
    raise exception 'FALLO: el admin pudo editar la auditoria';
  exception when insufficient_privilege then v_ok := v_ok + 1; end;
  begin
    delete from public.auditoria;
    raise exception 'FALLO: el admin pudo borrar la auditoria';
  exception when insufficient_privilege then v_ok := v_ok + 1; end;

  reset role;

  -- ===== 5. Reglas de integridad (como propietario) ===================
  v_fallo := false;
  begin delete from public.auditoria; v_fallo := true;
  exception when raise_exception then null; end;
  if v_fallo then raise exception 'FALLO: la auditoria se pudo borrar incluso como propietario'; end if;
  v_ok := v_ok + 1;

  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'x@example.invalid');
    insert into public.perfiles (id, rol, nombre)
      select id, 'agente', 'Sin agencia' from auth.users where email = 'x@example.invalid';
    raise exception 'FALLO: se creó un agente sin agencia';
  exception when check_violation then v_ok := v_ok + 1; end;

  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'y@example.invalid');
    insert into public.perfiles (id, agencia_id, rol, nombre)
      select id, v_ag_a, 'admin', 'Admin con agencia' from auth.users where email = 'y@example.invalid';
    raise exception 'FALLO: se creó un admin ligado a una agencia';
  exception when check_violation then v_ok := v_ok + 1; end;

  begin
    insert into public.agencias (codigo, nombre) values ('TST-A', 'Código repetido');
    raise exception 'FALLO: se aceptó un código de agencia repetido';
  exception when unique_violation then v_ok := v_ok + 1; end;

   raise exception 'PRUEBAS OK: % comprobaciones superadas (los datos de prueba se deshacen solos)', v_ok;
end;
$$;
