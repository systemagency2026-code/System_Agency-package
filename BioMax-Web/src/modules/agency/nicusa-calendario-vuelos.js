/* BioMax Logistics | Calendario NIC -> USA | 2026-11-22
 * Complemento independiente: usa SOLO las opciones ya autorizadas del selector de vuelos.
 * No escribe en Supabase, no cambia permisos, tarifas ni registro.
 */
(() => {
  'use strict';
  if (window.__biomaxCalendarioNICUSA) return;
  window.__biomaxCalendarioNICUSA = true;
  const CSS = `
  .bmcal{background:#fff;border:1px solid #dce5f1;border-radius:16px;padding:20px;margin:0 0 22px;color:#15243d;box-shadow:0 3px 12px #1027470a}
  .bmcal *{box-sizing:border-box}.bmcal-head{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px}
  .bmcal-title{font-size:19px;font-weight:750;margin:0}.bmcal-sub{font-size:13px;color:#64748b;margin-top:3px}
  .bmcal-legend{display:flex;gap:8px;flex-wrap:wrap}.bmcal-pill{padding:7px 10px;border-radius:9px;font-size:12px;font-weight:650}
  .bmcal-cut{background:#fff1c8;color:#80500a}.bmcal-flight{background:#e2f1ff;color:#0957a6}
  .bmcal-nav{display:flex;align-items:center;justify-content:space-between;background:#073d88;color:white;border-radius:11px;padding:8px 12px;margin-bottom:12px}
  .bmcal-nav button{background:#ffffff19;color:white;border:1px solid #ffffff50;border-radius:8px;font-size:24px;width:38px;height:36px;cursor:pointer}
  .bmcal-month{font-size:18px;font-weight:750;text-transform:capitalize;text-align:center}
  .bmcal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
  .bmcal-dayname{text-align:center;font-size:12px;font-weight:700;padding:9px 0;color:#52627a}
  .bmcal-cell{border:1px solid #e4eaf2;min-height:73px;border-radius:8px;padding:7px;text-align:center;background:#fff}
  .bmcal-cell.bmcal-blank{background:#f8fafc;border-color:transparent}.bmcal-num{font-size:15px;font-weight:700}
  .bmcal-mark{font-size:11px;font-weight:700;margin-top:5px;padding:3px 2px;border-radius:5px;line-height:1.3}
  .bmcal-mark.bmcal-cut{background:#fff1c8;color:#80500a}.bmcal-mark.bmcal-flight{background:#e2f1ff;color:#0957a6}
  .bmcal-note{font-size:12px;color:#64748b;margin-top:12px}
  @media(max-width:620px){.bmcal{padding:12px}.bmcal-cell{min-height:58px;padding:4px 1px}.bmcal-mark{font-size:9px}.bmcal-title{font-size:17px}.bmcal-month{font-size:16px}}
  `;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const pad = n => String(n).padStart(2,'0');
  const key = (y,m,d) => `${y}-${pad(m+1)}-${pad(d)}`;
  const dateParts = value => {
    const s = String(value || '').trim();
    let a = s.match(/(?:^|\D)(20\d{2})-(\d{1,2})-(\d{1,2})(?:\D|$)/);
    if (a) return valid(+a[1],+a[2],+a[3]);
    a = s.match(/(?:^|\D)(\d{1,2})\/(\d{1,2})\/(20\d{2})(?:\D|$)/);
    return a ? valid(+a[3],+a[2],+a[1]) : null;
  };
  function valid(y,m,d){const t=new Date(Date.UTC(y,m-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d ? [y,m-1,d]:null;}
  function datesFromSelect(select){
    const out = new Set();
    if (!select) return out;
    [...select.options].forEach(opt => {
      if (opt.disabled || !opt.value) return;
      const p = dateParts(opt.value) || dateParts(opt.textContent);
      if (p) out.add(key(...p));
    });
    return out;
  }
  function mount(view){
    if (view.querySelector('.bmcal')) return;
    const select = view.querySelector('#nicusa-vuelo');
    if (!select) return;
    const card = document.createElement('section'); card.className='bmcal'; card.setAttribute('aria-label','Calendario de vuelos Nicaragua a Estados Unidos');
    card.innerHTML=`<div class="bmcal-head"><div><h3 class="bmcal-title">Calendario de vuelos</h3><div class="bmcal-sub">Nicaragua → Estados Unidos</div></div><div class="bmcal-legend"><span class="bmcal-pill bmcal-cut">🔒 Corte</span><span class="bmcal-pill bmcal-flight">✈ Vuelo</span></div></div><div class="bmcal-nav"><button type="button" data-prev aria-label="Mes anterior">‹</button><span class="bmcal-month" aria-live="polite"></span><button type="button" data-next aria-label="Mes siguiente">›</button></div><div class="bmcal-grid"></div><div class="bmcal-note">El corte es dos días calendario antes de cada vuelo. Solo aparecen vuelos disponibles para esta cuenta.</div>`;
    const first = view.querySelector('article') || view.querySelector('form') || view.firstElementChild;
    if (first) view.insertBefore(card,first); else view.appendChild(card);
    let now = new Date(), year=now.getFullYear(),month=now.getMonth();
    const render=()=>{
      const flights=datesFromSelect(select), cuts=new Set();
      flights.forEach(s=>{const p=dateParts(s);if(!p)return;const t=new Date(Date.UTC(p[0],p[1],p[2]-2));cuts.add(key(t.getUTCFullYear(),t.getUTCMonth(),t.getUTCDate()));});
      card.querySelector('.bmcal-month').textContent=`${MONTHS[month]} ${year}`;
      const grid=card.querySelector('.bmcal-grid');grid.replaceChildren();
      ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].forEach(s=>{const el=document.createElement('div');el.className='bmcal-dayname';el.textContent=s;grid.append(el)});
      const offset=new Date(year,month,1).getDay(),days=new Date(year,month+1,0).getDate();
      for(let i=0;i<offset;i++){const el=document.createElement('div');el.className='bmcal-cell bmcal-blank';grid.append(el)}
      for(let d=1;d<=days;d++){
        const el=document.createElement('div');el.className='bmcal-cell';const n=document.createElement('div');n.className='bmcal-num';n.textContent=d;el.append(n);
        const k=key(year,month,d);
        if(cuts.has(k)){const b=document.createElement('div');b.className='bmcal-mark bmcal-cut';b.textContent='🔒 Corte';el.append(b)}
        if(flights.has(k)){const b=document.createElement('div');b.className='bmcal-mark bmcal-flight';b.textContent='✈ Vuelo';el.append(b)}
        grid.append(el);
      }
    };
    card.querySelector('[data-prev]').addEventListener('click',()=>{month--;if(month<0){month=11;year--}render()});
    card.querySelector('[data-next]').addEventListener('click',()=>{month++;if(month>11){month=0;year++}render()});
    const observer=new MutationObserver(render);observer.observe(select,{childList:true,subtree:true,attributes:true,characterData:true});
    select.addEventListener('change',render);
    render();
  }
  function scan(){
    ['#view-nic-usa-agencia','#view-nic-usa-admin','#view-nic-usa'].forEach(id=>{const v=document.querySelector(id);if(v)mount(v)});
    const sel=document.querySelector('#nicusa-vuelo');if(sel&&!sel.closest('.bmcal')&&!sel.closest('#view-nic-usa-agencia,#view-nic-usa-admin,#view-nic-usa')){const form=sel.closest('form');if(form)mount(form.parentElement)}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
  // Formulario puede insertarse cuando se abre la vista.
  const bodyObserver=new MutationObserver(()=>scan());
  if(document.body)bodyObserver.observe(document.body,{childList:true,subtree:true});
  else document.addEventListener('DOMContentLoaded',()=>bodyObserver.observe(document.body,{childList:true,subtree:true}));
})();
