# Guía de migraciones SQL

- M0: extensiones y fundamentos mínimos.
- M1: tablas, claves, restricciones e índices aprobados.
- M2: RLS y políticas revisadas.

M1 y M2 son marcadores de posición, no un esquema funcional. Prueba en local primero. Si una migración ya se aplicó en un entorno compartido, añade una nueva en vez de alterar el historial sin revisar. Nunca restablezcas producción.
