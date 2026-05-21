const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'jc_expenses_v2';
const OLD_STORAGE_KEY = 'jc_expenses_v1';
const IMG_KEY_PREFIX = 'jc_ticket_';
const CATEGORIES = ['Restaurante / comidas','Taxi / VTC','Parking','Peajes','Alojamiento','Viajes','Combustible','Material oficina','Software / SaaS','Formación','Servicios profesionales','Representación comercial','Otros','Revisar'];
const ESTADOS = ['Factura completa','Factura simplificada deducible','Ticket/factura simplificada no deducible IVA','Pendiente de revisión'];
const COLUMNS = ['ID','Fecha gasto','Fecha registro','Proveedor','NIF proveedor','Categoría','Descripción','Base imponible','IVA %','Cuota IVA','Total','Forma pago','Tarjeta últimos 4','Deducible IVA','Deducible gasto','Motivo profesional','Proyecto/cliente','Nombre archivo','Ruta archivo','Estado fiscal','Confianza OCR','Observaciones','Sincronización','Último error','Drive Web URL'];
const GOOGLE_SYNC_ENDPOINT = '/api/google-expense';
let currentBlob = null, currentFile = null, currentDataUrl = null, installPrompt = null;

function init(){
  CATEGORIES.forEach(v=> $('categoria').add(new Option(v,v)));
  ESTADOS.forEach(v=> $('estadoFiscal').add(new Option(v,v)));
  $('estadoFiscal').value='Pendiente de revisión';
  migrateStorage();
  renderTable();
  bind();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}
function bind(){
  $('photoInput').addEventListener('change', handleFile);
  $('ocrBtn').addEventListener('click', runOcr);
  $('clearBtn').addEventListener('click', clearCapture);
  $('saveBtn').addEventListener('click', saveExpense);
  $('recalcBtn').addEventListener('click', recalcVat);
  $('exportBtn').addEventListener('click', exportExcel);
  $('exportZipBtn').addEventListener('click', exportZip);
  $('syncPendingBtn').addEventListener('click', syncPending);
  $('testGoogleBtn').addEventListener('click', testGoogle);
  $('wipeBtn').addEventListener('click', wipeAll);
  ['base','ivaTipo','total'].forEach(id=>$(id).addEventListener('change',recalcVat));
  window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); installPrompt=e; $('installBtn').classList.remove('hidden'); });
  $('installBtn').addEventListener('click', async()=>{ if(installPrompt){ installPrompt.prompt(); installPrompt=null; $('installBtn').classList.add('hidden'); }});
}
function setStatus(message, type=''){
  $('status').textContent = message || '';
  $('status').classList.toggle('error', type==='error');
  $('status').classList.toggle('ok', type==='ok');
}
function showDiag(obj){
  $('syncDiag').classList.remove('hidden');
  $('syncDiagText').textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}
function fmtBytes(n){ if(!n) return '0 KB'; return n>1024*1024 ? (n/1024/1024).toFixed(2)+' MB' : (n/1024).toFixed(0)+' KB'; }
function migrateStorage(){
  if(!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(OLD_STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, localStorage.getItem(OLD_STORAGE_KEY));
}
async function handleFile(e){
  const file = e.target.files[0]; if(!file) return; currentFile=file; setStatus('Procesando imagen...'); $('originalName').textContent=file.name; $('originalType').textContent=file.type || file.name.split('.').pop(); $('originalSize').textContent=fmtBytes(file.size);
  try{
    let blob = file;
    const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    if(isHeic && window.heic2any){ setStatus('Convirtiendo HEIC/HEIF a JPEG...'); blob = await heic2any({blob:file, toType:'image/jpeg', quality:0.78}); }
    setStatus('Reduciendo tamaño para OCR y subida a Google...');
    if(window.imageCompression){
      blob = await imageCompression(blob, {
        maxSizeMB: 0.85,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
        initialQuality: 0.72,
        alwaysKeepResolution: false,
        fileType: 'image/jpeg'
      });
    }
    if(blob.size > 1200000 && window.imageCompression){
      blob = await imageCompression(blob, {maxSizeMB:0.65, maxWidthOrHeight:1400, useWebWorker:true, initialQuality:0.62, fileType:'image/jpeg'});
    }
    currentBlob = blob; currentDataUrl = await blobToDataURL(blob);
    $('processedSize').textContent=fmtBytes(blob.size); $('preview').src=currentDataUrl; $('previewWrap').classList.remove('hidden'); $('ocrBtn').disabled=false; $('clearBtn').disabled=false; setStatus('Imagen lista. Puedes leer el ticket o introducir datos manualmente.', 'ok');
  }catch(err){ console.error(err); setStatus('No he podido procesar la imagen. Prueba a hacer la foto en JPEG o selecciona otra.', 'error'); }
}
function blobToDataURL(blob){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(blob); }); }
async function runOcr(){
  if(!currentBlob) return; $('progress').classList.remove('hidden'); $('progress').value=0; setStatus('Leyendo ticket...');
  try{
    const result = await Tesseract.recognize(currentBlob, 'spa+eng', { logger:m=>{ if(m.progress) $('progress').value=Math.round(m.progress*100); if(m.status) setStatus(m.status); }});
    const text = result.data.text || ''; $('ocrText').value=text; autoFill(text, result.data.confidence || ''); setStatus('Lectura finalizada. Revisa los campos antes de guardar.', 'ok');
  }catch(err){ console.error(err); setStatus('Error OCR. Puedes rellenar los campos manualmente.', 'error'); }
}
function autoFill(text, confidence){
  const lines = text.split(/\n/).map(x=>x.trim()).filter(Boolean);
  const provider = lines.find(l=>/[A-ZÁÉÍÓÚÑ]{3,}/.test(l) && !/TOTAL|IVA|BASE|FECHA|TICKET/i.test(l)); if(provider && !$('proveedor').value) $('proveedor').value=provider.slice(0,60);
  const nif = text.match(/\b([A-Z]\d{7,8}[A-Z0-9]|\d{8}[A-Z])\b/i); if(nif) $('nif').value=nif[1].toUpperCase();
  const date = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/); if(date){ let y=date[3].length===2?'20'+date[3]:date[3]; $('fecha').value=`${y}-${date[2].padStart(2,'0')}-${date[1].padStart(2,'0')}`; }
  const allMoney = [...text.matchAll(/(\d{1,4}[,.]\d{2})\s*€?/g)].map(m=>parseFloat(m[1].replace(',','.'))).filter(n=>n>0 && n<10000);
  const totalLine = text.match(/(?:TOTAL|IMPORTE|TARJETA|VISA|MASTERCARD)[^\d]*(\d{1,4}[,.]\d{2})/i);
  const total = totalLine ? parseFloat(totalLine[1].replace(',','.')) : Math.max(...allMoney,0);
  if(total && isFinite(total)) $('total').value=total.toFixed(2);
  if(/restaurante|bar|cafe|cafeter/i.test(text)) $('categoria').value='Restaurante / comidas';
  if(/taxi|cabify|uber|vtc/i.test(text)) $('categoria').value='Taxi / VTC';
  if(/parking|aparcamiento/i.test(text)) $('categoria').value='Parking';
  const vatPct = text.match(/\b(21|10|4)\s*%/); if(vatPct) $('ivaTipo').value=vatPct[1];
  const last4 = text.match(/(?:\*{2,}|X{2,}|\.\.\.\.)\s*(\d{4})\b/i); if(last4) $('tarjeta').value=last4[1];
  recalcVat();
  $('observaciones').value = `OCR confianza aproximada: ${Math.round(confidence)}%. Revisar si el ticket identifica suficientemente el gasto, el IVA y la vinculación profesional.`;
}
function recalcVat(){
  const total=parseFloat($('total').value), tipo=parseFloat($('ivaTipo').value), base=parseFloat($('base').value);
  if(!isNaN(total) && tipo>=0){ const b= total/(1+tipo/100); $('base').value=b.toFixed(2); $('ivaCuota').value=(total-b).toFixed(2); }
  else if(!isNaN(base) && tipo>=0){ const iva=base*tipo/100; $('ivaCuota').value=iva.toFixed(2); $('total').value=(base+iva).toFixed(2); }
}
function loadExpenses(){ return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); }
function saveExpenses(rows){ localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); }
function normalizeName(s){ return (s||'SIN_PROVEEDOR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'_').replace(/^_|_$/g,'').slice(0,36); }
function makeId(){ return 'G'+new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14); }
async function saveExpense(){
  const id = makeId(); const fecha = $('fecha').value || new Date().toISOString().slice(0,10); const total = parseFloat($('total').value||0).toFixed(2);
  const ext = currentBlob ? 'jpg' : 'sinimagen'; const fileName = `${fecha}_${normalizeName($('categoria').value)}_${normalizeName($('proveedor').value)}_${String(total).replace('.', '-')}_${id}.${ext}`;
  if(currentDataUrl) localStorage.setItem(IMG_KEY_PREFIX+id, currentDataUrl);
  const estado = $('estadoFiscal').value;
  const row = {ID:id,'Fecha gasto':fecha,'Fecha registro':new Date().toISOString().slice(0,10),Proveedor:$('proveedor').value||'No visible','NIF proveedor':$('nif').value||'No visible',Categoría:$('categoria').value,Descripción:($('ocrText').value||'').slice(0,180),'Base imponible':num('base'),'IVA %':num('ivaTipo'),'Cuota IVA':num('ivaCuota'),Total:num('total'),'Forma pago':'Tarjeta','Tarjeta últimos 4':$('tarjeta').value||'', 'Deducible IVA': estado.includes('deducible') && !estado.includes('no deducible') ? 'Sí' : (estado.includes('Pendiente')?'Revisar':'No'),'Deducible gasto': $('motivo').value ? 'Revisar/posible' : 'Revisar','Motivo profesional':$('motivo').value,'Proyecto/cliente':$('proyecto').value,'Nombre archivo':fileName,'Ruta archivo':`localStorage:${IMG_KEY_PREFIX+id}`,'Estado fiscal':estado,'Confianza OCR':extractConfidence($('observaciones').value),'Observaciones':$('observaciones').value,'Sincronización':'Pendiente Google Drive/Sheets','Último error':'','Drive Web URL':''};
  const rows=loadExpenses(); rows.push(row); saveExpenses(rows); renderTable(); setStatus(`Gasto ${id} guardado localmente. Sincronizando con Google...`);
  await syncExpense(id);
}
function num(id){ const v=parseFloat($(id).value); return isNaN(v)?0:Math.round(v*100)/100; }
function extractConfidence(s){ const m=(s||'').match(/(\d+)%/); return m?Number(m[1]):''; }
function renderTable(){
  const rows=loadExpenses(); const thead=$('expensesTable').querySelector('thead tr'); const tbody=$('expensesTable').querySelector('tbody'); const mobile=$('mobileExpenseList'); thead.innerHTML=''; tbody.innerHTML=''; mobile.innerHTML=''; COLUMNS.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; thead.appendChild(th); });
  rows.forEach(r=>{
    const tr=document.createElement('tr'); COLUMNS.forEach(c=>{ const td=document.createElement('td'); fillCell(td, r, c); tr.appendChild(td); }); tbody.appendChild(tr);
    const card=document.createElement('article'); card.className='expense-card';
    const h=document.createElement('h3'); h.textContent=`${r['Fecha gasto']||''} · ${r.Proveedor||'Proveedor no visible'} · ${Number(r.Total||0).toFixed(2)} €`; card.appendChild(h);
    const dl=document.createElement('dl'); ['Categoría','Estado fiscal','Sincronización','Último error','Nombre archivo','Drive Web URL'].forEach(c=>{ const dt=document.createElement('dt'); dt.textContent=c; const dd=document.createElement('dd'); fillCell(dd, r, c); dl.append(dt,dd); }); card.appendChild(dl); mobile.appendChild(card);
  });
}
function fillCell(el, r, c){
  if(c==='Nombre archivo' && localStorage.getItem(IMG_KEY_PREFIX+r.ID)){ const a=document.createElement('a'); a.href=localStorage.getItem(IMG_KEY_PREFIX+r.ID); a.download=r['Nombre archivo']; a.textContent=r[c] || 'Ticket local'; el.appendChild(a); }
  else if(c==='Drive Web URL' && r[c]){ const a=document.createElement('a'); a.href=r[c]; a.target='_blank'; a.rel='noopener'; a.textContent='Abrir en Drive'; el.appendChild(a); }
  else el.textContent = r[c] ?? '';
}
async function safeJson(res){
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { ok:false, error: text.slice(0,500) || `HTTP ${res.status}` }; }
}
async function syncExpense(id){
  const rows = loadExpenses(); const index = rows.findIndex(r => r.ID === id); if(index < 0) return;
  const row = rows[index]; if(row['Sincronización'] === 'Sincronizado' && row['Drive Web URL']) return;
  const imageDataUrl = localStorage.getItem(IMG_KEY_PREFIX + id);
  if(!imageDataUrl){ row['Sincronización'] = 'Sin imagen local para subir'; row['Último error']='No existe imagen en este dispositivo'; saveExpenses(rows); renderTable(); return; }
  try{
    const payload = JSON.stringify({ expense: row, imageDataUrl });
    if(payload.length > 3500000) throw new Error(`Imagen demasiado grande para Vercel (${fmtBytes(payload.length)}). Haz la foto más alejada o usa menor resolución.`);
    const res = await fetch(GOOGLE_SYNC_ENDPOINT, { method: 'POST', headers: {'Content-Type':'application/json'}, body: payload });
    const data = await safeJson(res);
    if(!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    row['Ruta archivo'] = data.driveUrl; row['Drive Web URL'] = data.driveUrl; row['Sincronización'] = 'Sincronizado'; row['Último error']='';
    saveExpenses(rows); renderTable(); setStatus(`Gasto ${id} sincronizado con Google Drive y Google Sheets.`, 'ok');
  }catch(err){
    console.error(err); row['Sincronización'] = 'Pendiente'; row['Último error'] = err.message; saveExpenses(rows); renderTable(); setStatus(`No se ha sincronizado con Google: ${err.message}`, 'error'); showDiag({id, error:err.message, endpoint:GOOGLE_SYNC_ENDPOINT});
  }
}
async function syncPending(){
  const pending = loadExpenses().filter(r => r['Sincronización'] !== 'Sincronizado').map(r => r.ID);
  if(!pending.length){ setStatus('No hay gastos pendientes de sincronizar.', 'ok'); return; }
  for(const id of pending){ await syncExpense(id); }
}
async function testGoogle(){
  setStatus('Probando conexión con Google...');
  try{
    const res = await fetch(`${GOOGLE_SYNC_ENDPOINT}?check=1`, {method:'GET'});
    const data = await safeJson(res);
    showDiag(data);
    if(!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setStatus('Conexión Google correcta. La carpeta Drive y el Google Sheets son accesibles.', 'ok');
  }catch(err){
    showDiag({error:err.message}); setStatus(`La prueba Google ha fallado: ${err.message}`, 'error');
  }
}
function exportExcel(){
  const rows=loadExpenses(); if(!rows.length){ alert('No hay gastos para exportar.'); return; }
  const ws = XLSX.utils.json_to_sheet(rows, {header:COLUMNS}); ws['!cols']=COLUMNS.map(c=>({wch: Math.min(Math.max(c.length+4,14),34)}));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
  const resumen = [['Indicador','Valor'],['Nº gastos',rows.length],['Total gastos',sum(rows,'Total')],['IVA soportado',sum(rows,'Cuota IVA')],['Pendientes revisión',rows.filter(r=>String(r['Estado fiscal']).includes('Pendiente')||String(r['Deducible IVA']).includes('Revisar')).length]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen'); XLSX.writeFile(wb, `Jaccobson_Gastos_${new Date().toISOString().slice(0,10)}.xlsx`);
}
function sum(rows,k){ return rows.reduce((a,r)=>a+(Number(r[k])||0),0).toFixed(2); }
async function exportZip(){
  const rows=loadExpenses(); if(!rows.length){ alert('No hay gastos para exportar.'); return; }
  const zip=new JSZip(); rows.forEach(r=>{ const data=localStorage.getItem(IMG_KEY_PREFIX+r.ID); if(data){ zip.file(r['Nombre archivo'], data.split(',')[1], {base64:true}); }});
  const blob=await zip.generateAsync({type:'blob'}); downloadBlob(blob, `Jaccobson_Tickets_${new Date().toISOString().slice(0,10)}.zip`);
}
function downloadBlob(blob, name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
function clearCapture(){ currentBlob=null; currentFile=null; currentDataUrl=null; $('photoInput').value=''; $('previewWrap').classList.add('hidden'); $('ocrBtn').disabled=true; $('clearBtn').disabled=true; setStatus(''); }
function wipeAll(){ if(!confirm('¿Borrar todos los gastos y tickets almacenados en este dispositivo?')) return; Object.keys(localStorage).filter(k=>k.startsWith(IMG_KEY_PREFIX)||k===STORAGE_KEY||k===OLD_STORAGE_KEY).forEach(k=>localStorage.removeItem(k)); renderTable(); }
init();
