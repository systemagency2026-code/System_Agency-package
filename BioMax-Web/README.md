# Frontend del sistema

## Arranque local

1. Copia `src/core/js/config.example.js` → `src/core/js/config.js`
2. Pega URL y anon key de Supabase
3. Abre `index.html` con Live Server o:
   npx serve .

## Estructura

- `index.html` — acceso (login / registro)
- `src/modules/admin` — panel administrador
- `src/modules/agency` — panel agencia
- `src/modules/auth` — autenticación

## Importante

No subir `config.js` a Git. Solo existe en cada máquina / servidor de deploy.
