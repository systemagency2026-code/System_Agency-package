# Sistema de gestión logística (Admin + Agencias)

Portal web para red de paquetería / agencias (USA–NIC).
Incluye panel de **administrador global**, panel de **sucursal (agente)** y backend en **Supabase** (Auth, PostgreSQL, Storage, Edge Functions).

---

## Qué incluye el MVP

### Panel administrador

- Resumen general (KPIs, ingresos ~30 días, ranking de agencias, estados de contenedores, actividad reciente)
- Solicitudes de **afiliación** (aprobar / rechazar, código, tarifas por vía, logo)
- Gestión de **agencias** (activar / desactivar, datos de contacto)
- **Contenedores / cortes** (crear, filtrar por agencia, eliminar)
- **Bultos / paquetes** (cliente, tracking, peso, vía, costo según tarifa de la agencia, foto)
- **Solicitudes de sucursal** (consolidador, inspección, cambio de velocidad: listar, filtrar, responder, evidencia)

### Panel agencia (sucursal)

- Resumen de la sucursal (KPIs y gráfico propios)
- Clientes (alta, estado activo/inactivo)
- Contenedores asignados (ver bultos, marcar **Actualizar** → estado _Recibido_, abonos)
- Envío de solicitudes de servicio al admin
- Historial de solicitudes y respuesta del admin

### Backend (Supabase)

- Autenticación por correo y contraseña
- Tablas principales: `agencias`, `solicitudes_afiliacion`, `cortes_contenedores`, `paquetes_bultos`, `clientes_agencia`, `solicitudes_sucursal`
- Storage: `logos-agencias`, `evidencias-solicitudes`
- Edge Function `afiliaciones` (aprobar / rechazar con lógica de servidor)

---

## Estructura del repositorio

```text
/
├── README.md                 ← este archivo
├── .gitignore
├── docs/                     ← notas de arquitectura, deploy, seguridad (opcional)
├── mandala-db/               ← SQL / Edge Functions (referencia)
│   └── supabase/functions/afiliaciones/
└── mandala-web/              ← frontend que se despliega
    ├── index.html            ← login / registro
    ├── assets/
    └── src/
        ├── core/
        │   ├── js/
        │   │   ├── config.example.js   ← plantilla (sí en Git)
        │   │   └── config.js           ← credenciales reales (NO en Git)
        │   └── styles/                 ← variables, base, reset
        └── modules/
            ├── auth/
            ├── admin/                  ← dashboard-admin.html/css/js
            └── agency/                 ← dashboard-agency.html/css/js
```
