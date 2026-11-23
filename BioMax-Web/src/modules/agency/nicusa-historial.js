
/* BioMax NIC-USA: historial de solo lectura; usa RLS y limita resultados. */
(() => {
  async function iniciar() {
    const tabla = document.querySelector('#nicusa-hist-tabla tbody');
    const estado = document.getElementById('nicusa-hist-estado');
    if (!tabla || !estado) return;

    const obtenerSupabase = () => window.supabase;
    const busqueda = document.getElementById('nicusa-hist-buscar');
    const vueloFiltro = document.getElementById('nicusa-hist-vuelo');
    const agenciaFiltro = document.getElementById('nicusa-hist-agencia');
    const detalle = document.getElementById('nicusa-hist-detalle');
    const csv = document.getElementById('nicusa-hist-csv');

    let registros = [];
    let agencias = new Map();
    let logosAgencias = new Map();
    let vuelos = new Map();
    
    async function cargarFechasHistoricas(sb, envios) {
      const fechas = new Map();

      for (const envio of envios) {
        if (!envio.vuelo_id) continue;

        const { data, error } = await sb.rpc(
          'nicusa_fecha_vuelo_historial',
          { p_envio_id: envio.id }
        );

        if (error) {
          console.error('Error consultando fecha histórica:', error);
          continue;
        }

        const registro = data?.[0];
        if (registro?.vuelo_id && registro?.fecha) {
          fechas.set(registro.vuelo_id, registro.fecha);
        }
      }

      return fechas;
    }

    let cargando = false;

    const money = v => 'US$' + Number(v || 0).toFixed(2);
    const peso = v => v == null ? '—' : Number(v).toFixed(2) + ' lbs';
    const ref = r => String(r.id).slice(0, 8).toUpperCase();

    const celda = (tr, value) => {
      const td = tr.insertCell();
      td.textContent = String(value ?? '—');
      td.style.cssText = 'padding:10px;border-bottom:1px solid #e2e8f0;white-space:nowrap';
      return td;
    };

    const visibles = () => registros.filter(r => {
      const q = (busqueda?.value || '').trim().toLocaleLowerCase();
      return (
        (!q || [r.id, r.destinatario, r.remitente]
          .some(v => String(v || '').toLocaleLowerCase().includes(q))) &&
        (!vueloFiltro?.value || r.vuelo_id === vueloFiltro.value) &&
        (!agenciaFiltro?.value || r.agencia_id === agenciaFiltro.value)
      );
    });

    function mostrarDetalle(r) {
      if (!detalle) return;
      detalle.replaceChildren();
      detalle.hidden = false;

      const h = document.createElement('h4');
      h.textContent = 'Detalle del envío ' + ref(r);
      detalle.append(h);

      const campos = [
        ['Referencia completa', r.id],
        ['Agencia', agencias.get(r.agencia_id) || r.agencia_id],
        ['Vuelo', vuelos.get(r.vuelo_id) || r.vuelo_id],
        ['Remitente', r.remitente],
        ['Teléfono remitente', r.remitente_telefono],
        ['Destinatario', r.destinatario],
        ['Teléfono destinatario', r.destinatario_telefono],
        ['Dirección', [r.calle, r.apartamento, r.ciudad, r.estado, r.zip].filter(Boolean).join(', ')],
        ['Inventario', r.inventario],
        ['Categorías', Object.entries(r.categorias || {}).map(([k, v]) => k + ': ' + v).join(' · ')],
        ['Peso real', peso(r.peso_real_agencia)],
        ['Peso facturable', peso(r.peso_facturable)],
        ['Importe agencia', money(r.importe_agencia)],
        ['Observaciones', r.observaciones || '—']
      ];

      const dl = document.createElement('dl');
      dl.style.cssText = 'display:grid;grid-template-columns:minmax(130px,200px) 1fr;gap:8px;white-space:pre-wrap;overflow-wrap:anywhere';

      for (const [k, v] of campos) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        dt.style.fontWeight = '700';
        const dd = document.createElement('dd');
        dd.textContent = v ?? '—';
        dd.style.margin = '0';
        dl.append(dt, dd);
      }
      detalle.append(dl);

      if (r.foto_ruta) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-secondary';
        b.textContent = 'Ver fotografía privada';

        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const sb = obtenerSupabase();
            if (!sb) throw new Error('Servicio no disponible');
            const { data, error } = await sb.storage
              .from('nicusa-fotos')
              .createSignedUrl(r.foto_ruta, 60);
            if (error) throw error;
            window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
          } catch (e) {
            console.error('Error abriendo fotografía:', e);
            estado.textContent = 'No fue posible abrir la fotografía. Intentá nuevamente.';
          } finally {
            b.disabled = false;
          }
        });
        detalle.append(b);
      }

      // Etiqueta 4 × 6: sin tarifas ni costos del transportador.
      const imprimir = document.createElement('button');
      imprimir.type = 'button';
      imprimir.className = 'btn-secondary';
      imprimir.textContent = 'Imprimir etiqueta 4 × 6 / Guardar PDF';

      imprimir.addEventListener('click', () => {
        const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;',
          '"': '&quot;', "'": '&#39;'
        }[c]));

        const nombreAgencia = agencias.get(r.agencia_id) || 'Agencia';
        const logoRaw = logosAgencias.get(r.agencia_id) || '';
        const logoAgencia = /^https:\/\//i.test(logoRaw) ? logoRaw : '';
        const ventana = window.open('', '_blank', 'width=540,height=820');

        if (!ventana) {
          estado.textContent = 'Permití ventanas emergentes para imprimir la etiqueta.';
          return;
        }

        ventana.document.write(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Etiqueta ${esc(ref(r))}</title>
<style>
@page { size:4in 6in; margin:0 }
* { box-sizing:border-box }
body { margin:0; color:#111; font-family:Arial,sans-serif }
.etiqueta {
  width:4in; height:6in; padding:.22in;
  display:flex; flex-direction:column; border:1px solid #222
}
.logo-agencia {
  display:block; max-width:2.9in; max-height:1.15in;
  object-fit:contain; margin:0 auto 8px
}
.agencia {
  font-size:19pt; font-weight:800; text-align:center;
  border-bottom:2px solid #111; padding-bottom:9px;
  overflow-wrap:anywhere
}
.ref { text-align:center; font-size:10pt; padding:10px 0 }
.sub {
  font-size:9pt; font-weight:700;
  text-transform:uppercase; margin:12px 0 4px
}
.dest { font-size:19pt; font-weight:800; overflow-wrap:anywhere }
.dir { font-size:14pt; line-height:1.3; overflow-wrap:anywhere }
.zip { font-size:17pt; font-weight:800; margin-top:7px; overflow-wrap:anywhere }
.pie {
  margin-top:auto; text-align:center;
  border-top:1px solid #222; padding-top:9px; font-size:8pt
}
@media screen {
  body { background:#ddd; padding:12px }
  .etiqueta { background:#fff; margin:auto }
}
@media print {
  body { padding:0 }
  .etiqueta { border:0 }
}
</style>
</head>
<body>
<div class="etiqueta">
${logoAgencia ? `<img class="logo-agencia" src="${esc(logoAgencia)}" alt="Logo de ${esc(nombreAgencia)}">` : ''}
<div class="agencia">${esc(nombreAgencia)}</div>
<div class="ref">Referencia: ${esc(ref(r))}</div>
<div class="sub">Destinatario</div>
<div class="dest">${esc(r.destinatario)}</div>
<div class="sub">Dirección de entrega</div>
<div class="dir">${esc(r.calle)}${r.apartamento ? '<div>' + esc(r.apartamento) + '</div>' : ''}</div>
<div class="zip">${esc([r.ciudad, r.estado, r.zip].filter(Boolean).join(', '))}</div>
<div class="pie">Gracias por confiar en BioMax Logistics</div>
</div>
</body>
</html>`);

        ventana.document.close();
        ventana.focus();

        const imagenLogo = ventana.document.querySelector('.logo-agencia');
        if (imagenLogo) {
          if (imagenLogo.complete) {
            if (imagenLogo.naturalWidth > 0) ventana.print();
            else estado.textContent = 'El logo registrado no pudo cargarse. Revisá su URL.';
          } else {
            imagenLogo.addEventListener('load', () => ventana.print(), { once:true });
            imagenLogo.addEventListener('error', () => {
              estado.textContent = 'No se pudo cargar el logo de la agencia.';
            }, { once:true });
          }
        } else {
          estado.textContent = 'La agencia no tiene un logo URL válido disponible para la etiqueta.';
        }
      });

      detalle.append(imprimir);
      detalle.scrollIntoView({ behavior:'smooth', block:'nearest' });
    }

    function render() {
      tabla.replaceChildren();
      const rows = visibles();

      estado.textContent = registros.length === 0
        ? 'No hay envíos registrados para tu agencia.'
        : `${rows.length} envío(s) visible(s) de ${registros.length} cargado(s).`;

      if (csv) csv.disabled = !rows.length;

      rows.forEach(r => {
        const tr = tabla.insertRow();
        celda(tr, ref(r));
        celda(tr, vuelos.get(r.vuelo_id) || '—');
        celda(tr, r.destinatario);
        celda(tr, peso(r.peso_real_agencia));
        celda(tr, peso(r.peso_facturable));
        celda(tr, money(r.importe_agencia));

        const td = tr.insertCell();
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-secondary';
        b.textContent = 'Ver detalle';
        b.addEventListener('click', () => mostrarDetalle(r));
        td.append(b);
      });
    }

    async function cargar() {
      if (cargando) return;

      const sb = obtenerSupabase();
      const identidad = window.biomaxAgenciaActual;

      if (!sb || !identidad?.id) {
        estado.textContent = 'Preparando el historial de envíos…';
        return;
      }

      cargando = true;
      estado.textContent = 'Consultando envíos…';

      try {
        const { data: { user }, error: ue } = await sb.auth.getUser();
        if (ue || !user) throw new Error('Sesión no disponible');

        // Identidad validada y publicada por dashboard-agency.js.
        const agenciaId = identidad.id;

        const { data, error } = await sb
          .from('nicusa_envios')
          .select('id,agencia_id,vuelo_id,remitente,remitente_telefono,destinatario,destinatario_telefono,calle,apartamento,ciudad,estado,zip,categorias,inventario,observaciones,peso_real_agencia,peso_facturable,importe_agencia,foto_ruta,creado_en')
          .eq('agencia_id', agenciaId)
          .order('creado_en', { ascending:false })
          .limit(200);

        if (error) throw error;
        registros = data || [];

        const [a, v] = await Promise.all([
          sb.from('agencias')
            .select('id,nombre,logo_url')
            .eq('id', agenciaId),
          sb.from('nicusa_vuelos')
            .select('id,fecha')
            .order('fecha', { ascending:false })
            .limit(100)
        ]);

        if (a.error) throw a.error;
        if (v.error) throw v.error;

        agencias = new Map((a.data || []).map(x => [x.id, x.nombre]));
        logosAgencias = new Map((a.data || []).map(x => [x.id, x.logo_url || '']));
        
        vuelos = new Map((v.data || []).map(x => [x.id, x.fecha]));

        const fechasHistoricas = await cargarFechasHistoricas(sb, registros);
        for (const [vueloId, fecha] of fechasHistoricas) {
          vuelos.set(vueloId, fecha);
        }


        if (vueloFiltro) {
          const selected = vueloFiltro.value;
          vueloFiltro.replaceChildren(new Option('Todos los vuelos', ''));
          for (const x of v.data || []) {
            vueloFiltro.add(new Option(x.fecha, x.id));
          }
          vueloFiltro.value = selected;
        }

        if (agenciaFiltro) {
          agenciaFiltro.replaceChildren(
            new Option('Mi agencia', String(agenciaId))
          );
          agenciaFiltro.value = String(agenciaId);
        }

        render();
      } catch (e) {
        console.error('BioMax NIC-USA: error al cargar historial:', e);
        registros = [];
        tabla.replaceChildren();
        if (csv) csv.disabled = true;
        estado.textContent = 'No fue posible cargar el historial. Intentá nuevamente con «Actualizar historial».';
      } finally {
        cargando = false;
      }
    }

    window.addEventListener('biomax:agencia-lista', cargar);

    for (const input of [busqueda, vueloFiltro, agenciaFiltro].filter(Boolean)) {
      input.addEventListener(input === busqueda ? 'input' : 'change', render);
    }

    document.getElementById('nicusa-hist-recargar')
      ?.addEventListener('click', cargar);

    window.addEventListener('biomax:nicusa-registrado', cargar);

    csv?.addEventListener('click', () => {
      const cols = [
        'Referencia', 'Vuelo', 'Remitente', 'Destinatario',
        'Telefono destinatario', 'Direccion', 'Inventario',
        'Peso real lbs', 'Peso facturable lbs', 'Importe USD'
      ];

      const lines = [
        cols,
        ...visibles().map(r => [
          r.id,
          vuelos.get(r.vuelo_id) || '',
          r.remitente,
          r.destinatario,
          r.destinatario_telefono,
          [r.calle, r.apartamento, r.ciudad, r.estado, r.zip]
            .filter(Boolean).join(', '),
          r.inventario,
          r.peso_real_agencia,
          r.peso_facturable,
          r.importe_agencia
        ])
      ];

      const escaped = lines.map(row =>
        row.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')
      ).join('\r\n');

      const blob = new Blob(['\ufeff' + escaped], {
        type:'text/csv;charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'biomax-nicusa-historial.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    await cargar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
