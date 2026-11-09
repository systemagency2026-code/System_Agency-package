# Modelo de seguridad

- Aplicar mínimo privilegio y preferir cuentas individuales.
- Validar entradas y autorizar operaciones en backend/base de datos.
- Aislar los datos de cada agencia. Ocultar botones no es control de acceso.
- Mantener secretos fuera de Git y de archivos servidos al navegador.
- No registrar contraseñas, tokens ni claves.
- Usar HTTPS y probar respaldos/restauración.

## Si se usa Supabase
- Activar RLS en cada tabla accesible desde el cliente.
- Crear políticas explícitas para cada operación y rol.
- Verificar relación entre `auth.uid()`, perfil, agencia y rol.
- Nunca incluir `service_role` en frontend ni en variables `VITE_*`.
- Probar que una agencia no puede leer ni modificar recursos de otra.
- Revisar con cuidado funciones `SECURITY DEFINER`.

No usar datos reales ni desplegar antes de revisar las políticas y pruebas.
