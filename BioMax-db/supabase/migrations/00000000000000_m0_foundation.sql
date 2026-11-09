-- =====================================================================
-- M0 · Fundamentos
-- Prepara el esquema privado, los tipos base y la política de permisos
-- por defecto. No crea tablas de negocio.
-- =====================================================================

-- Esquema privado: Supabase NO lo expone por la API, así que las funciones
-- de seguridad que viven aquí no pueden llamarse desde el navegador.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Mínimo privilegio: las tablas nuevas de "public" nacen SIN permisos para
-- anon/authenticated. Cada migración concede explícitamente lo necesario.
-- (Así, olvidar un GRANT falla cerrado; olvidar una política RLS también.)
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Tipos base (enums: evitan estados escritos como texto libre)
create type public.rol_usuario       as enum ('admin', 'agente');
create type public.estado_agencia    as enum ('activa', 'suspendida');
create type public.estado_afiliacion as enum ('pendiente', 'aprobada', 'rechazada');

-- Mantiene "actualizado_en" al día en cualquier tabla que lo tenga
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
