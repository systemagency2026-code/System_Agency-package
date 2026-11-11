
create table public.auditoria (
  id          bigint generated always as identity primary key,
  ocurrido_en timestamptz not null default now(),
  actor_id    uuid,
  agencia_id  uuid,
  accion      text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  entidad     text not null,
  entidad_id  text,
  detalle     jsonb not null default '{}'::jsonb
);
create index ix_auditoria_fecha   on public.auditoria (ocurrido_en desc);
create index ix_auditoria_entidad on public.auditoria (entidad, entidad_id);
create index ix_auditoria_agencia on public.auditoria (agencia_id, ocurrido_en desc);

create function private.auditar_cambio()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_fila    jsonb;
  v_detalle jsonb;
begin
  if tg_op = 'DELETE' then
    v_fila := to_jsonb(old);  v_detalle := v_fila;
  elsif tg_op = 'INSERT' then
    v_fila := to_jsonb(new);  v_detalle := v_fila;
  else
    v_fila := to_jsonb(new);
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('antes', o.value, 'despues', n.value)), '{}'::jsonb)
      into v_detalle
      from jsonb_each(to_jsonb(new)) n
      left join jsonb_each(to_jsonb(old)) o on o.key = n.key
     where n.value is distinct from o.value and n.key <> 'actualizado_en';
    if v_detalle = '{}'::jsonb then
      return null;
    end if;
  end if;

  insert into public.auditoria (actor_id, agencia_id, accion, entidad, entidad_id, detalle)
  values (
    (select auth.uid()),
    case when tg_table_name = 'agencias' then (v_fila ->> 'id')::uuid
         else (v_fila ->> 'agencia_id')::uuid end,
    tg_op, tg_table_name, v_fila ->> 'id', v_detalle
  );
  return null;
end;
$$;

create function private.auditoria_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La tabla de auditoría es de solo inserción';
end;
$$;

revoke all on function private.auditar_cambio()      from public;
revoke all on function private.auditoria_inmutable() from public;

create trigger trg_auditoria_sin_cambios before update or delete on public.auditoria
  for each row execute function private.auditoria_inmutable();
create trigger trg_auditoria_sin_truncate before truncate on public.auditoria
  for each statement execute function private.auditoria_inmutable();

create trigger trg_audit_agencias after insert or update or delete on public.agencias
  for each row execute function private.auditar_cambio();
create trigger trg_audit_perfiles after insert or update or delete on public.perfiles
  for each row execute function private.auditar_cambio();
create trigger trg_audit_afiliacion after update on public.solicitudes_afiliacion
  for each row execute function private.auditar_cambio();

grant select on public.auditoria to authenticated;
alter table public.auditoria enable row level security;
create policy auditoria_admin_lee on public.auditoria
  for select to authenticated using ((select private.es_admin()));
