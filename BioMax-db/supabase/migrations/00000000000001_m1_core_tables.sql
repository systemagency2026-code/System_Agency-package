-- =====================================================================
-- M1 · Identidad: agencias, perfiles y solicitudes de afiliación
-- Incluye RLS desde el primer momento.
-- Reglas CONFIRMADAS: ninguna aún. Todo lo de aquí es PROPUESTO.
-- =====================================================================

-- ---------- Tablas ----------------------------------------------------

create table public.agencias (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null,
  nombre         text not null,
  correo         text,
  telefono       text,
  direccion      text,
  estado         public.estado_agencia not null default 'activa',
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ck_agencias_codigo   check (codigo ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
  constraint ck_agencias_nombre   check (char_length(btrim(nombre)) between 2 and 120),
  constraint ck_agencias_correo   check (correo is null or correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint ck_agencias_telefono check (telefono is null or char_length(telefono) <= 30),
  constraint ck_agencias_direccion check (direccion is null or char_length(direccion) <= 300)
);
create unique index ux_agencias_codigo on public.agencias (codigo);

-- Un perfil por cada usuario de Supabase Auth (las contraseñas viven en auth.users,
-- nunca en nuestras tablas). Se desactiva, no se borra: protege el historial.
create table public.perfiles (
  id             uuid primary key references auth.users (id) on delete restrict,
  agencia_id     uuid references public.agencias (id) on delete restrict,
  rol            public.rol_usuario not null default 'agente',
  nombre         text not null,
  telefono       text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ck_perfiles_nombre   check (char_length(btrim(nombre)) between 2 and 120),
  constraint ck_perfiles_telefono check (telefono is null or char_length(telefono) <= 30),
  -- El admin no pertenece a ninguna agencia; todo agente pertenece a una.
  constraint ck_perfiles_rol_agencia check (
    (rol = 'admin'  and agencia_id is null) or
    (rol = 'agente' and agencia_id is not null)
  )
);
create index ix_perfiles_agencia on public.perfiles (agencia_id);

-- Solicitud pública de afiliación. NO guarda contraseña: al aprobarla se
-- invitará a la persona por correo para que cree la suya.
create table public.solicitudes_afiliacion (
  id              uuid primary key default gen_random_uuid(),
  nombre_negocio  text not null,
  nombre_contacto text not null,
  correo          text not null,
  telefono        text,
  direccion       text,
  mensaje         text,
  estado          public.estado_afiliacion not null default 'pendiente',
  motivo_rechazo  text,
  agencia_id      uuid references public.agencias (id) on delete restrict,
  revisada_por    uuid references public.perfiles (id) on delete restrict,
  revisada_en     timestamptz,
  creada_en       timestamptz not null default now(),
  constraint ck_afil_negocio  check (char_length(btrim(nombre_negocio))  between 2 and 120),
  constraint ck_afil_contacto check (char_length(btrim(nombre_contacto)) between 2 and 120),
  constraint ck_afil_correo   check (char_length(correo) <= 254 and correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint ck_afil_telefono check (telefono  is null or char_length(telefono)  <= 30),
  constraint ck_afil_direccion check (direccion is null or char_length(direccion) <= 300),
  constraint ck_afil_mensaje  check (mensaje   is null or char_length(mensaje)   <= 1000),
  constraint ck_afil_motivo   check (motivo_rechazo is null or char_length(motivo_rechazo) <= 500),
  -- Coherencia entre estado y datos de revisión
  constraint ck_afil_coherencia check (
    (estado = 'pendiente' and revisada_en is null and agencia_id is null and motivo_rechazo is null)
    or (estado = 'aprobada'  and revisada_en is not null and agencia_id is not null)
    or (estado = 'rechazada' and revisada_en is not null and agencia_id is null and motivo_rechazo is not null)
  )
);
-- Una sola solicitud pendiente por correo (frena duplicados y spam trivial)
create unique index ux_afil_pendiente_correo
  on public.solicitudes_afiliacion (lower(correo)) where estado = 'pendiente';
create index ix_afil_estado on public.solicitudes_afiliacion (estado, creada_en desc);

-- ---------- Funciones de seguridad (esquema privado) -----------------
-- SECURITY DEFINER: leen "perfiles" sin disparar RLS (evita recursión) y
-- devuelven NULL/false si el usuario o su agencia están inactivos o
-- suspendidos. Así, suspender corta el acceso aunque el token siga vigente.

create function private.es_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = (select auth.uid()) and p.rol = 'admin' and p.activo
  );
$$;

create function private.agencia_actual()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.agencia_id
  from public.perfiles p
  join public.agencias a on a.id = p.agencia_id
  where p.id = (select auth.uid())
    and p.rol = 'agente' and p.activo and a.estado = 'activa';
$$;

revoke all on function private.es_admin()       from public;
revoke all on function private.agencia_actual() from public;
grant execute on function private.es_admin()       to authenticated;
grant execute on function private.agencia_actual() to authenticated;

-- ---------- Triggers -------------------------------------------------

create trigger trg_agencias_updated before update on public.agencias
  for each row execute function private.set_updated_at();
create trigger trg_perfiles_updated before update on public.perfiles
  for each row execute function private.set_updated_at();

-- Una solicitud resuelta no se vuelve a tocar; el revisor y la fecha los
-- pone el servidor, no el cliente.
create function private.validar_afiliacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado <> 'pendiente' then
    raise exception 'La solicitud ya fue resuelta y no puede modificarse';
  end if;
  if (select auth.uid()) is not null then
    new.revisada_por := (select auth.uid());
  end if;
  if new.estado <> 'pendiente' then
    new.revisada_en := coalesce(new.revisada_en, now());
  end if;
  return new;
end;
$$;
revoke all on function private.validar_afiliacion() from public;

create trigger trg_afil_validar before update on public.solicitudes_afiliacion
  for each row execute function private.validar_afiliacion();

-- ---------- Permisos (GRANT) -----------------------------------------
-- Sin DELETE para nadie: el historial no se borra desde la API.

grant select, insert, update on public.agencias to authenticated;
grant select, update         on public.perfiles to authenticated;  -- INSERT solo vía service_role (Edge Function)

-- El anónimo solo puede INSERTAR estas columnas; no puede fijar estado ni revisión.
grant insert (nombre_negocio, nombre_contacto, correo, telefono, direccion, mensaje)
  on public.solicitudes_afiliacion to anon;
grant select on public.solicitudes_afiliacion to authenticated;
grant update (estado, motivo_rechazo, agencia_id) on public.solicitudes_afiliacion to authenticated;

-- ---------- RLS ------------------------------------------------------

alter table public.agencias               enable row level security;
alter table public.perfiles               enable row level security;
alter table public.solicitudes_afiliacion enable row level security;

-- agencias
create policy agencias_admin_todo on public.agencias
  for all to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
create policy agencias_agente_lee_la_suya on public.agencias
  for select to authenticated
  using (id = (select private.agencia_actual()));

-- perfiles
create policy perfiles_admin_lee on public.perfiles
  for select to authenticated using ((select private.es_admin()));
create policy perfiles_admin_actualiza on public.perfiles
  for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
create policy perfiles_agente_lee_el_suyo on public.perfiles
  for select to authenticated
  using (id = (select auth.uid()) and (select private.agencia_actual()) is not null);

-- solicitudes_afiliacion
create policy afil_anon_inserta on public.solicitudes_afiliacion
  for insert to anon
  with check (estado = 'pendiente' and revisada_por is null and revisada_en is null
              and agencia_id is null and motivo_rechazo is null);
create policy afil_admin_lee on public.solicitudes_afiliacion
  for select to authenticated using ((select private.es_admin()));
create policy afil_admin_actualiza on public.solicitudes_afiliacion
  for update to authenticated
  using ((select private.es_admin())) with check ((select private.es_admin()));
