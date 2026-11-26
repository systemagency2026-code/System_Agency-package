// BioMax NIC-USA: calculo previo alineado con trigger SQL v12.
const TARIFAS=Object.freeze({general:14,medicamentos:50,documentos:60,pasaportes:60,inyectables:12,retorno:25,insulina:18,termico:5,promo5:68.75,promo10:135,promo15:198.75,promo20:260});
const PROMOS={promo5:{lbs:5,med:.5},promo10:{lbs:10,med:1},promo15:{lbs:15,med:1},promo20:{lbs:20,med:1}};
const red=n=>Math.ceil((n-1e-9)*2)/2;
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
function calcularNICUSA(d,precios={}){
 const p={...TARIFAS,...precios}, n=k=>{const v=Number(d[k]??0);if(!Number.isFinite(v)||v<0)throw Error('Cantidad inválida: '+k);return v};
 const general=n('general'),med=n('medicamentos'),retorno=n('retorno'),docs=n('documentos'),pas=n('pasaportes'),iny=n('inyectables'),ins=n('insulina'),ter=n('termico');
 for(const k of ['documentos','pasaportes','inyectables','insulina','termico'])if(!Number.isInteger(n(k)))throw Error('Se requieren unidades enteras: '+k);
 const promo=d.promo||null,beneficio=d.beneficio||'ninguno';
 if(promo&&!PROMOS[promo])throw Error('Promoción inválida');
 if(!promo&&beneficio!=='ninguno')throw Error('Beneficio requiere promoción');
 if(!['ninguno','medicamentos','documentos','pasaportes'].includes(beneficio))throw Error('Beneficio inválido');
 if(med>2)throw Error('Medicamentos: máximo 2 lbs por declaración');
 for(const k of Object.keys(TARIFAS)){if(!Number.isFinite(Number(p[k]))||Number(p[k])<0)throw Error('Tarifa inválida: '+k)}
 if(iny>0&&!promo&&general===0&&med===0&&retorno===0&&docs===0&&pas===0&&ins===0&&iny<3)throw Error('Mínimo 3 inyectables cuando viajan solos');
 if(ins>0&&!promo&&general<3)throw Error('Insulina fuera de promoción requiere 3 lbs de carga general');
 const lines=[];const add=(concepto,importe)=>{if(importe)lines.push({concepto,importe:money(importe)})};
 let real=general+med+retorno, fact=0;
 if(promo){
  const cfg=PROMOS[promo],fisico=Number(d.pesoFisicoPromo);
  if(!Number.isFinite(fisico)||fisico<=0||fisico+1e-9<real)throw Error('Peso físico de promoción inválido');
  if(beneficio==='pasaportes'&&promo==='promo5')throw Error('Combo 5 no incluye pasaporte');
  if(beneficio==='documentos'&&docs<1||beneficio==='pasaportes'&&pas<1)throw Error('Falta artículo del beneficio seleccionado');
  real=fisico;fact=cfg.lbs+red(Math.max(0,fisico-cfg.lbs));
  add('Combo '+cfg.lbs+' lbs',p[promo]);
  const medIncluido=beneficio==='medicamentos'?Math.min(med,cfg.med):0;
  const extraMed=Math.max(0,med-medIncluido);
  add('Medicamentos adicionales',extraMed>0?Math.max(1,red(extraMed))*p.medicamentos:0);
  add('Documentos adicionales',(docs-(beneficio==='documentos'?1:0))*p.documentos);
  add('Pasaportes adicionales',(pas-(beneficio==='pasaportes'?1:0))*p.pasaportes);
  const exceso=Math.max(0,fisico-cfg.lbs);add('Exceso de peso general',red(exceso)*p.general);
 }else{
  const soloGeneral=general>0&&med===0&&docs===0&&pas===0&&iny===0&&ins===0&&retorno===0&&ter===0;
  // Mínimo confirmado por BioMax: 3 lbs cuando la carga general viaja sola.
  const fg=soloGeneral?Math.max(3,red(general)):red(general),fm=med>0?Math.max(1,red(med)):0;
  fact=fg+fm;add('Carga general',fg*p.general);add('Medicamentos',fm*p.medicamentos);
  add('Documentos legales',docs*p.documentos);add('Pasaportes',pas*p.pasaportes);
 }
 if(retorno>0){add('Retorno prepagado',p.retorno);add('Exceso retorno',red(Math.max(0,retorno-3))*p.general);if(!promo)fact+=red(retorno)}
 add('Inyectables',iny*p.inyectables);add('Insulina y derivados',ins*p.insulina);add('Empaque térmico',ter*p.termico);
 return {importe:money(lines.reduce((s,l)=>s+l.importe,0)),pesoReal:money(real),pesoFacturable:money(fact),lineas:lines,tarifasAplicadas:p};
}
window.BioMaxNICUSATarifas={TARIFAS,calcularNICUSA};
