# BioMax Logistics — Nicaragua → Estados Unidos
## Especificación consolidada para desarrollo | 15 de noviembre de 2026

**Estado:** requisitos acordados y paquete de interfaz preliminar. **NO equivale a funcionalidades implementadas ni autorizadas para producción.**

### 1. Alcance y separación funcional
- **Formulario de agencia (NIC → USA, únicamente aéreo):** captura del envío, destinatario, inventario, categorías de carga, peso real/facturable, fecha de vuelo y futura cotización conforme al tarifario administrado.
- **Reporte 1 — Manifiesto del transportador Managua → Miami:** vista exclusiva del SuperAdmin, agrupada por fecha de vuelo, con peso manual independiente y costo de transporte a $7 por libra.
- El peso/costo del reporte **no altera** el peso, tarifas, cobro ni registros originales de la agencia. No se muestran esos campos administrativos a agencias.

### 2. Formulario y permisos
- Agencia asignada automáticamente desde la identidad/sesión; no hay selector de agencia en el formulario ordinario.
- Conservar `agencia_id` (propietaria) y `creado_por` (autor); editar no transfiere propiedad.
- Agencia: registrar y consultar sus propios envíos. SuperAdmin: consulta global, administración, correcciones, reportes, configuración de vuelos y tarifas. Operador: consulta conforme a permisos que se validarán.
- Destinatario: **nombre y apellido en un solo campo**; teléfono; dirección exacta; ciudad, estado y ZIP Code de Estados Unidos.
- Autocompletado futuro en el mismo campo de nombre, con destinatarios históricos **de la misma agencia** y recuperación de sus datos, sujeto a reglas de privacidad y RLS.
- Inventario de artículos, foto, observaciones y demás campos obligatorios del formulario previamente definido.
- Fecha de vuelo: opciones creadas/habilitadas por SuperAdmin; agencia selecciona una opción vigente.
- Múltiples tipos de carga por envío. **Cada categoría debe recibir su peso real o cantidad propia** y subtotal calculado con su tarifario. Categorías como documentos se cobran **por unidad**, no por libra. Las tarifas y reglas específicas se configurarán/validarán antes de implementar.
- Para cargas por peso: entrada decimal libre; conservar peso real y calcular facturable al siguiente incremento de 0.50 lb, sujeto a reglas específicas por categoría. Ej.: 2.10 → 2.50; 2.74 → 3.00. El total combina subtotales, no multiplica todo el peso por todas las tarifas.
- Etiqueta 4×6: especificada en la sección 6 de este documento; implementación pendiente. Estados, resumen, reportes adicionales, tracking UPS/USPS con enlace e historial de modificaciones: etapas posteriores según acuerdos previos.

### 3. Reporte 1 — Transportador Managua → Miami
**Acceso:** exclusivamente SuperAdmin para editar peso y generar/exportar manifiesto. Las agencias no pueden consultar ni modificar el peso ni el costo del transportador.

**Filtro principal:** fecha de vuelo seleccionada. Reunir envíos de todas las agencias asociados al vuelo; preservar vínculo con agencia propietaria.

**Columnas, exactamente en este orden:**
1. Agencia
2. Nombre y Apellido más teléfono de quien recibe
3. Dirección exacta de entrega
4. Ciudad, Estado y ZIP Code
5. Inventario de Artículos en Paquete
6. Peso Managua-Miami
7. Envío $

**Reglas de las dos últimas columnas:**
- `Peso Managua-Miami`: digitación manual por SuperAdmin, por envío; peso **exacto sin caja de empaque**, independiente del peso capturado por agencia y **sin redondeo de 0.50 lb**.
- `Envío $`: cálculo automático `peso_managua_miami × 7.00 USD/lb`.
- Totales por fecha de vuelo: suma de pesos manuales y suma de importes. Los registros sin peso manual deben identificarse como **pendientes**, no considerarse automáticamente peso cero.
- Persistir el peso administrativo para reapertura del reporte, con control de permisos e historial de modificaciones cuando se implemente la base de datos.
- Exportación prevista: Excel y PDF, respetando el orden de columnas.

**Ejemplo ilustrativo:** peso manual 4.25 lb → 4.25 × $7 = $29.75. Este peso no se copia al formulario de la agencia.

### 4. Estado real del paquete de código adjunto
- La **Etapa 2.2** existente es una **vista preliminar**, no guarda registros, no cobra, no calcula tarifas combinadas y no conecta autocompletado a Supabase.
- Contiene un campo único de destinatario, selección múltiple de categorías y un único campo de peso preliminar; **falta** implementar campos de peso/cantidad por categoría.
- El reporte Managua–Miami está **especificado en este documento, NO implementado** en los archivos de interfaz existentes.
- Rama de trabajo: `biomax-nic-usa-formulario`; commit visto en conversación `fd660b9`. **No fusionar con `main` ni publicar** sin revisión y pruebas.
- Evitar consultas repetitivas, escrituras o migraciones en Supabase hasta revisar recursos, esquema y políticas RLS. El despliegue preview de Cloudflare no garantiza comportamiento funcional ni permisos.

### 5. Orden sugerido de ejecución
1. Verificar archivos y ruta real del formulario en la rama de desarrollo.
2. Implementar interfaz de peso/cantidad por categoría y vista de reporte 1 sin escrituras.
3. Probar SuperAdmin y usuario agencia por separado; verificar aislamiento de datos y roles.
4. Diseñar persistencia y permisos RLS de forma controlada; validar costos y rendimiento antes de aplicar.
5. Probar manifiesto por vuelo, cálculos, edición manual, totales y exportación; desplegar solo tras aprobación explícita.

**Decisiones pendientes:** tarifas definitivas por categoría, reglas de mínimos/redondeos por categoría, tratamiento de envíos con varios bultos y criterios exactos para edición/cierre de manifiestos. No inventar estas reglas en código.

### 6. Etiqueta de envío 4×6 pulgadas — Nicaragua → Estados Unidos
**Propósito:** etiqueta imprimible por envío, generada con los datos ya registrados; no equivale a una guía de UPS/USPS ni requiere generar un tracking externo.

**Contenido obligatorio:**
1. **Logo de la agencia propietaria** del envío, obtenido del registro de agencia en BioMax (si está disponible). Mantener proporciones originales, sin deformarlo. Si falta el logo, mostrar el nombre de la agencia sin impedir imprimir.
2. **Nombre de la agencia propietaria** (por ejemplo, PrimeGerón); usar el vínculo `agencia_id` del envío, nunca la agencia de la sesión del SuperAdmin que lo consulta.
3. **Nombre y apellido completos del destinatario**, exactamente como aparecen en el campo único del formulario.
4. **Dirección exacta de entrega** del destinatario, respetando número, apartamento/unidad y demás datos registrados.
5. **Ciudad, estado y ZIP Code** del destinatario, claramente visibles.
6. **Peso total registrado por la agencia en el formulario**, en libras. Cuando haya varias categorías de carga, sumar únicamente los pesos de las categorías medidas en libras; las categorías cobradas por unidad (p. ej., documentos) no deben convertirse arbitrariamente a libras. Definir y verificar si se imprime peso real total o facturable total antes de implementación definitiva; el usuario pidió “peso total ingresado en sistema por la agencia”, por lo que se propone **peso real total**, sin usar el peso del transportador.
7. Leyenda discreta al pie, en letras pequeñas: **“Envío apoyado y ejecutado por BioMax Logistics”**.

**Reglas de diseño y permisos:**
- Tamaño físico de impresión **4 × 6 pulgadas** (101.6 × 152.4 mm), orientación vertical, tipografía legible en impresora térmica blanco y negro, sin depender de fondos de color.
- Priorizar nombre/dirección y legibilidad del ZIP; logo arriba, leyenda al pie. No recortar información larga: ajustar saltos de línea.
- La agencia puede visualizar/imprimir las etiquetas de sus propios envíos; SuperAdmin puede visualizar/imprimir las de todas las agencias. El logo y nombre corresponden a la agencia propietaria del registro.
- La etiqueta no muestra costos, tarifas, datos administrativos del transportador, ni el peso manual Managua–Miami.
- Reutilizar datos ya disponibles al cargar el envío y el perfil de la agencia; no realizar polling ni consultas periódicas por etiqueta. La generación local de una vista imprimible no exige nuevas tablas SQL.
- **Estado:** especificación aprobada para el paquete de desarrollo, **NO implementada** en los cuatro archivos originales de la Etapa 2.2.

**Pendiente puntual:** confirmar en pruebas la fuente y disponibilidad del logo de agencia en la estructura existente, y precisar la regla de peso total cuando existan categorías por unidad. No inventar valores faltantes.

### 7. Resumen visual interno de envíos por agencia — NIC → USA (Reporte / Vista 2)
**Propósito:** pantalla interna para consultar los envíos creados mediante el formulario, distinta del manifiesto administrativo Managua–Miami (Reporte 1) y de la etiqueta 4×6. Sin logotipos ni elementos de impresión de etiquetas.

**Alcance y acceso:**
- **Agencia:** ve exclusivamente los envíos vinculados a su `agencia_id`, asignado al crear el envío. No elige otra agencia ni accede a datos de terceros. Puede consultar su resumen y el detalle de cada envío.
- **SuperAdmin:** puede consultar el global de todas las agencias y filtrar/seleccionar una agencia específica antes de revisar sus envíos. Puede administrar los estados del transporte y registrar/corregir el número de rastreo según permisos definidos.
- **Operador:** acceso sujeto a permisos explícitos que deberán verificarse; no otorgar acceso global por defecto.
- Los controles de acceso deben aplicarse en el servidor/base de datos (RLS), no únicamente ocultando elementos de la interfaz.

**Datos visibles por envío:**
1. Nombre y apellido completos del destinatario (campo único del formulario).
2. Teléfono del destinatario.
3. Dirección exacta del destinatario, más ciudad, estado y ZIP Code.
4. Fecha de vuelo seleccionada en el formulario.
5. Peso registrado por la agencia. Mostrar peso real total de categorías expresadas en libras; no convertir categorías por unidad (documentos) a libras ni confundir con el peso manual del transportador. Si es útil para facturación, diferenciar visualmente peso real y peso facturable.
6. **Proceso del transporte:** estado operativo del envío, visible a la agencia y editable solo por personal autorizado. Ejemplos propuestos: `Registrado`, `Salió de Nicaragua`, `Llegó a Miami`, `En camino al destino final`, `Entregado`. Estados adicionales, transiciones y quién puede editarlos deberán validarse antes de habilitar.
7. **Número de rastreo UPS:** ingresado por personal autorizado. Mostrarlo como hipervínculo que abra la página oficial de seguimiento de UPS con el número codificado correctamente. Si no hay número, mostrar `Pendiente de rastreo`, sin inventarlo. No equivale a integración automática de estados ni a contratación de una guía UPS.
8. **Costo total del envío:** suma de subtotales por categorías según las tarifas y reglas aplicables a ese envío; no incluir el costo interno del transportador Managua–Miami. Debe distinguirse claramente del importe de $7/lb del Reporte 1.

**Vista y resumen de totales:**
- Para agencia: listado y resumen de **cantidad de envíos, suma de pesos reales registrados (lb) y suma de costos totales** exclusivamente de sus envíos. Posibilidad de consultar detalle de cada envío.
- Para SuperAdmin: vista global y filtro de agencia, con los mismos indicadores calculados para la selección actual. Filtro adicional por fecha de vuelo recomendado; al cambiar filtros, recalcular el resumen para los registros visibles.
- Cuando un envío incluya documentos u otros conceptos por unidad, su costo se suma al total monetario pero **no se suma como libras**.
- Datos no registrados o aún no calculados deben mostrarse como `Pendiente` o `—`, nunca inventar importes o pesos.
- Sin logos ni arte promocional; diseño legible y funcional dentro del sistema.

**Reglas técnicas y rendimiento:**
- Esta vista consulta registros existentes, sin duplicar envíos ni crear una copia de los datos para el resumen.
- Cargar datos bajo demanda, paginar listados grandes y evitar polling o refrescos continuos; priorizar rendimiento en Supabase Nano.
- Guardar cambios de estado y tracking solo al realizar acciones explícitas autorizadas; registrar autor y fecha del cambio cuando se implemente auditoría.
- El seguimiento UPS es un **enlace externo**, no una integración automática con UPS. URL oficial de seguimiento debe verificarse en implementación.
- **Estado actual:** requisitos incorporados al paquete maestro; NO implementados en los cuatro archivos de la Etapa 2.2. NO habilitar en producción ni ejecutar migraciones sin revisión de código, esquema y RLS.

**Decisiones por validar:** catálogo definitivo de estados, permisos exactos de operadores, edición de registros por SuperAdmin, filtros adicionales, y forma de presentar tarifas cuando haya categorías mixtas.
