// BioMax NIC→USA. Motor determinista, sin acceso a Supabase.
const TARIFAS = Object.freeze({general:14,medicamentos:50,documentos:60,pasaportes:60,inyectables:12,retorno:25,insulina:18,termico:5,promo5:68.75,promo10:135,promo15:198.75,promo20:260});
const PROMOS={promo5:{lbs:5,med:0.5},promo10:{lbs:10,med:1},promo15:{lbs:15,med:1},promo20:{lbs:20,med:1}};
const peso=x=>Math.ceil((x-1e-9)*2)/2;
const money=x=>Math.round((x+Number.EPSILON)*100)/100;
const nonneg=(n,k)=>{n=Number(n??0);if(!Number.isFinite(n)||n<0)throw Error('Cantidad inválida: '+k);return n};
const entero=(n,k)=>{n=nonneg(n,k);if(!Number.isInteger(n))throw Error('Unidades enteras requeridas: '+k);return n};
function calcularNICUSA(datos, precios={}) {
 const p={...TARIFAS,...precios};
 for(const [k,v] of Object.entries(p))if(!Number.isFinite(Number(v))||Number(v)<0)throw Error('Tarifa inválida: '+k);
 const general=nonneg(datos.general,'general'),med=nonneg(datos.medicamentos,'medicamentos'),retorno=nonneg(datos.retorno,'retorno');
 const docs=entero(datos.documentos,'documentos'),pas=entero(datos.pasaportes,'pasaportes'),iny=entero(datos.inyectables,'inyectables'),ins=entero(datos.insulina,'insulina'),ter=entero(datos.termico,'termico');
 const promo=datos.promo||null;if(promo&&!PROMOS[promo])throw Error('Promoción inválida');
 const soloIny=iny>0&&!promo&&general===0&&med===0&&retorno===0&&docs===0&&pas===0&&ins===0;
 if(soloIny&&iny<3)throw Error('Mínimo 3 inyectables cuando viajan solos');
 if(med>2+1e-9&&!datos.autorizacionMedicamentos)throw Error('Medicamentos: máximo 2 lbs reales por declaración; requiere autorización ViewMax');
 if(ins>0&&!promo&&general<3)throw Error('Insulina fuera de promoción requiere 3 lbs reales de carga general');
 if(retorno>0&&datos.retornoIncluido===false)throw Error('Retorno no habilitado');
 const lineas=[];const agregar=(nombre,importe)=>{importe=money(importe);if(importe)lineas.push({concepto:nombre,importe})};
 let totalReal=general+med+retorno;
 totalReal+=nonneg(datos.pesoOtros,'pesoOtros');
 let pesoFacturable=0;
 if(promo){
   const cfg=PROMOS[promo];const medIncluido=datos.beneficio==='medicamentos';
   if(!['ninguno','medicamentos','documentos','pasaportes'].includes(datos.beneficio||'ninguno'))throw Error('Beneficio inválido');
   if(promo==='promo5'&&datos.beneficio==='pasaportes')throw Error('Promo 5 lbs no incluye pasaporte');
   if(datos.beneficio==='documentos'&&docs<1)throw Error('El beneficio de documentos requiere un documento');
   if(datos.beneficio==='pasaportes'&&pas<1)throw Error('El beneficio de pasaporte requiere un pasaporte');
   const base=Number(p[promo]);agregar('Combo '+cfg.lbs+' lbs',base);
   const descuentoMed=medIncluido?Math.min(med,cfg.med):0;
   const medExtra=Math.max(0,med-descuentoMed-nonneg(datos.excesoMedicamentos,'excesoMedicamentos'));
   const docsExtra=Math.max(0,docs-(datos.beneficio==='documentos'?1:0));
   const pasExtra=Math.max(0,pas-(datos.beneficio==='pasaportes'?1:0));
   agregar('Medicamentos adicionales',peso(medExtra)*Number(p.medicamentos));
   agregar('Documentos adicionales',docsExtra*Number(p.documentos));
   agregar('Pasaportes adicionales',pasExtra*Number(p.pasaportes));
   const excedente=Math.max(0,totalReal-cfg.lbs);
   if(excedente>1e-9){
     const eg=nonneg(datos.excesoGeneral,'excesoGeneral'),em=nonneg(datos.excesoMedicamentos,'excesoMedicamentos');
     if(Math.abs(eg+em-excedente)>0.011)throw Error('Desglosá el excedente de '+excedente.toFixed(2)+' lbs por categoría');
     agregar('Exceso general',peso(eg)*Number(p.general));
     agregar('Exceso medicamentos',peso(em)*Number(p.medicamentos));
   }
   pesoFacturable=cfg.lbs+peso(excedente);
 }else{
   const fg=peso(general); // Sin mínimo artificial de 3 lbs: 2.50 permanece 2.50.
   agregar('Carga general',fg*Number(p.general));pesoFacturable+=fg;
   const fm=med>0?Math.max(1,peso(med)):0;
   agregar('Medicamentos',fm*Number(p.medicamentos));pesoFacturable+=fm;
   agregar('Documentos legales',docs*Number(p.documentos));
   agregar('Pasaportes',pas*Number(p.pasaportes));
 }
 if(retorno>0){agregar('Retorno prepagado',Number(p.retorno));const extra=Math.max(0,retorno-3);agregar('Exceso retorno',peso(extra)*Number(p.general));}
 agregar('Inyectables',iny*Number(p.inyectables));
 agregar('Insulina y derivados',ins*Number(p.insulina));
 agregar('Empaque térmico',ter*Number(p.termico));
 return {importe:money(lineas.reduce((s,l)=>s+l.importe,0)),pesoReal:money(totalReal),pesoFacturable:money(pesoFacturable),lineas,tarifasAplicadas:p};
}
window.BioMaxNICUSATarifas={TARIFAS,calcularNICUSA};
