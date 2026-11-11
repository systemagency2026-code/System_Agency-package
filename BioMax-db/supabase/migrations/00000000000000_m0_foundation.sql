
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

create type public.rol_usuario       as enum ('admin', 'agente');
create type public.estado_agencia    as enum ('activa', 'suspendida');
create type public.estado_afiliacion as enum ('pendiente', 'aprobada', 'rechazada');

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public;
