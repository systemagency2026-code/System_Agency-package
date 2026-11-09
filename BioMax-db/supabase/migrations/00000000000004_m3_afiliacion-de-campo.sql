alter table public.solicitudes_afiliacion
  add column departamento      text,
  add column codigo_referencia text;

alter table public.solicitudes_afiliacion
  add constraint ck_afil_departamento check (departamento is null or char_length(btrim(departamento)) between 2 and 60),
  add constraint ck_afil_referencia   check (codigo_referencia is null or char_length(codigo_referencia) <= 50);

grant insert (departamento, codigo_referencia) on public.solicitudes_afiliacion to anon;
