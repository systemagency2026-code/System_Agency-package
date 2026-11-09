INSERT INTO public.perfiles (id, rol, nombre, activo)
SELECT id, 'admin', 'Administrador Principal', true
FROM auth.users
WHERE email = 'systemagency2026@gmail.com'
ON CONFLICT (id)
DO UPDATE SET rol = 'admin', activo = true;
