# Operación y despliegue

Proveedor y arquitectura final pendientes.

Antes de producción: aprobar requisitos; configurar variables fuera de Git; revisar y aplicar migraciones al entorno correcto; verificar autenticación, autorización y RLS; ejecutar pruebas funcionales y de aislamiento; configurar HTTPS, dominio y CORS; configurar logs seguros; respaldos y restauración; plan de reversión; documentar responsables.

**Precaución:** `supabase db reset` reconstruye la base local. Nunca ejecutarlo en producción. No aplicar migraciones destructivas sin respaldo, revisión y autorización.
