# Visión general de arquitectura

**Estado: propuesta pendiente de validar.**

- `interlink-web/`: prototipo HTML, CSS y JavaScript nativo.
- `interlink-db/`: migraciones y pruebas PostgreSQL/Supabase.
- `interlink-api/`: espacio opcional para una API independiente.
- `docs/`: documentación funcional, técnica y operativa.

## Opciones por decidir
**A.** Supabase Auth + PostgreSQL + RLS y funciones necesarias.
**B.** Frontend + API Node.js/TypeScript + PostgreSQL/Supabase.

No crear una API separada solo por tener la carpeta. Elegir según seguridad, reglas de negocio, presupuesto y mantenimiento. La maqueta no implementa autenticación, persistencia ni permisos.
