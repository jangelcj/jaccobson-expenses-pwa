const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'jc_expenses_v4';
const LEGACY_KEYS = ['jc_expenses_v3', 'jc_expenses_v2', 'jc_expenses_v1'];
const IMG_KEY_PREFIX = 'jc_ticket_';
const CATEGORIES = ['Restaurante / comidas','Taxi / VTC','Parking','Peajes','Alojamiento','Viajes','Combustible','Material oficina','Software / SaaS','Formación','Servicios profesionales','Representación comercial','Otros','Revisar'];
const ESTADOS = ['Factura completa','Factura simplificada deducible','Ticket/factura simplificada no deducible IVA','Pendiente de revisión'];
const COLUMNS = ['ID','Fecha gasto','Fecha registro','Proveedor','NIF proveedor','Categoría','Descripción','Base imponible','IVA %','Cuota IVA','Total','Forma pago','Deducible IVA','Deducible gasto','Motivo profesional','Proyecto/cliente','Nombre archivo','Ruta archivo','Estado fiscal','Confianza OCR','Observaciones','Sincronización','Último error','Drive Web URL'];
const GOOGLE_SYNC_ENDPOINT = '/api/google-expense';
let currentBlob = null;
let currentFile = null;
let currentDataUrl = null;
let installPrompt = null;
let lastAutoFillWarnings = [];

function init(){
  CATEGORIES.forEach(v => $('categoria').add(new Option(v, v)));
  ESTADOS.forEach(v => $('estadoFiscal').add(new Option(v, v)));
  $('estadoFiscal').value = 'Pendiente de revisión';
  migrateStorage();
  renderTable();
  bind();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

function bind(){
  $('chooseTicketBtn').addEventListener('click', openSourceSheet);
  $('openCameraBtn').addEventListener('click', () => chooseSource('cameraInput'));
  $('openLibraryBtn').addEventListener('click', () => chooseSource('libraryInput'));
  $('cancelSourceBtn').addEventListener('click', closeSourceSheet);
  $('sourceSheet').addEventListener('click', (e) => { if (e.target.id === 'sourceSheet') closeSourceSheet(); });
  $('cameraInput').addEventListener('change', handleFile);
  $('libraryInput').addEventListener('change', handleFile);
  $('clearBtn').addEventListener('click', clearCapture);
  $('menuBtn').addEventListener('click', openDrawer);
  $('closeDrawerBtn').addEventListener('click', closeDrawer);
  $('drawerBackdrop').addEventListener('click', closeDrawer);
  $('saveBtn').addEventListener('click', saveExpense);
  $('recalcBtn').addEventListener('click', recalcVatFromTotal);
  $('exportBtn').addEventListener('click', () => { closeDrawer(); exportExcel(); });
  $('exportZipBtn').addEventListener('click', () => { closeDrawer(); exportZip(); });
  $('syncPendingBtn').addEventListener('click', () => { closeDrawer(); syncPending(); });
  $('testGoogleBtn').addEventListener('click', testGoogle);
  $('connectGoogleBtn').addEventListener('click', () => { window.location.href = '/api/google-oauth-start'; });
  $('wipeBtn').addEventListener('click', () => { closeDrawer(); wipeAll(); });
  document.querySelectorAll('.collapse-toggle').forEach(btn => btn.addEventListener('click', toggleCollapse));
  $('base').addEventListener('change', recalcVatFromBase);
  $('ivaTipo').addEventListener('change', () => {
    if ($('total').value) recalcVatFromTotal();
    else recalcVatFromBase();
  });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('installBtn').classList.remove('hidden'); });
  $('installBtn').addEventListener('click', async () => {
    if (installPrompt) { installPrompt.prompt(); installPrompt = null; $('installBtn').classList.add('hidden'); }
  });
}

function openSourceSheet(){ $('sourceSheet').classList.remove('hidden'); }
function closeSourceSheet(){ $('sourceSheet').classList.add('hidden'); }
function chooseSource(inputId){ closeSourceSheet(); $(inputId).click(); }

function toggleCollapse(e){
  const btn = e.currentTarget;
  const body = $(btn.dataset.target);
  const expanded = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!expanded));
  body.classList.toggle('collapsed', expanded);
}

function openDrawer(){ $('appDrawer').classList.remove('hidden'); $('drawerBackdrop').classList.remove('hidden'); $('menuBtn').setAttribute('aria-expanded','true'); $('appDrawer').setAttribute('aria-hidden','false'); }
function closeDrawer(){ $('appDrawer').classList.add('hidden'); $('drawerBackdrop').classList.add('hidden'); $('menuBtn').setAttribute('aria-expanded','false'); $('appDrawer').setAttribute('aria-hidden','true'); }
function setStatus(msg, type=''){ const el=$('status'); el.textContent=msg||''; el.className='status '+type; }
function fmtBytes(bytes){ if(!bytes) return '0 B'; const units=['B','KB','MB']; let n=bytes,i=0; while(n>1024&&i<units.length-1){n/=1024;i++;} return `${n.toFixed(i?1:0)} ${units[i]}`; }

function showDiag(data, status='info'){
  $('syncDiag').classList.remove('hidden');
  $('diagBadge').textContent = status === 'ok' ? 'Correcto' : status === 'error' ? 'Error' : 'Diagnóstico';
  $('diagBadge').className = `badge ${status}`;
  $('diagTitle').textContent = data.title || (status === 'ok' ? 'Conexión correcta' : 'Resultado de conexión');
  $('diagSummary').textContent = data.userMessage || data.error || data.notes || 'Resultado disponible.';
  $('syncDiagText').textContent = JSON.stringify(data, null, 2);
}

function migrateStorage(){
  if (localStorage.getItem(STORAGE_KEY)) return;
  for (const key of LEGACY_KEYS) {
    const value = localStorage.getItem(key);
    if (value) { localStorage.setItem(STORAGE_KEY, value); return; }
  }
}

async function handleFile(e){
  const file = e.target.files[0];
  if (!file) return;
  currentFile = file;
  resetForm(false);
  clearWarnings();
  setStatus('Procesando imagen...');
  $('originalName').textContent = file.name;
  $('originalType').textContent = file.type || file.name.split('.').pop();
  $('originalSize').textContent = fmtBytes(file.size);
  try{
    let blob = file;
    const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    if (isHeic && window.heic2any) {
      setStatus('Convirtiendo HEIC/HEIF a JPEG...');
      blob = await heic2any({ blob:file, toType:'image/jpeg', quality:0.78 });
    }
    setStatus('Reduciendo tamaño para OCR y subida a Google...');
    if (window.imageCompression) {
      blob = await imageCompression(blob, { maxSizeMB:0.85, maxWidthOrHeight:1600, useWebWorker:true, initialQuality:0.72, alwaysKeepResolution:false, fileType:'image/jpeg' });
    }
    if (blob.size > 1200000 && window.imageCompression) {
      blob = await imageCompression(blob, { maxSizeMB:0.65, maxWidthOrHeight:1400, useWebWorker:true, initialQuality:0.62, fileType:'image/jpeg' });
    }
    currentBlob = blob;
    currentDataUrl = await blobToDataURL(blob);
    $('processedSize').textContent = fmtBytes(blob.size);
    $('preview').src = currentDataUrl;
    $('previewWrap').classList.remove('hidden');
    $('clearBtn').disabled = false;
    setStatus('Imagen preparada. Iniciando lectura automática del ticket...', 'ok');
    await runOcr();
  }catch(err){
    console.error(err);
    setStatus('No he podido procesar la imagen. Prueba a hacer la foto en JPEG o selecciona otra.', 'error');
  } finally {
    e.target.value = '';
  }
}

function blobToDataURL(blob){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); }); }

async function runOcr(){
  if (!currentBlob) return;
  $('progress').classList.remove('hidden'); $('progress').value = 0;
  setStatus('Leyendo ticket...');
  try{
    const result = await Tesseract.recognize(currentBlob, 'spa+eng', {
      logger:m => { if(m.progress) $('progress').value = Math.round(m.progress*100); if(m.status) setStatus(m.status); }
    });
    const text = result.data.text || '';
    $('ocrText').value = text;
    autoFill(text, result.data.confidence || '');
    setStatus('Lectura finalizada. Revisa los campos antes de guardar.', 'ok');
  }catch(err){
    console.error(err);
    markWarning('ocrText', 'No se ha podido leer el ticket automáticamente. Puedes rellenarlo manualmente.');
    setStatus('Error OCR. Puedes rellenar los campos manualmente.', 'error');
  }
}

function autoFill(text, confidence){
  clearWarnings();
  const lines = text.split(/\n/).map(x => x.trim()).filter(Boolean);
  const provider = lines.find(l => /[A-ZÁÉÍÓÚÑ]{3,}/.test(l) && !/TOTAL|IVA|BASE|FECHA|TICKET|FACTURA|SIMPLIFICADA/i.test(l));
  setField('proveedor', provider ? provider.slice(0, 60) : '', 'No he identificado con seguridad el proveedor.');

  const nif = text.match(/\b([A-Z]\d{7,8}[A-Z0-9]|\d{8}[A-Z])\b/i);
  setField('nif', nif ? nif[1].toUpperCase() : '', 'No he identificado NIF/CIF del proveedor.');

  const date = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (date) {
    let y = date[3].length === 2 ? '20' + date[3] : date[3];
    setField('fecha', `${y}-${date[2].padStart(2,'0')}-${date[1].padStart(2,'0')}`, '');
  } else {
    markWarning('fecha', 'No he identificado la fecha del gasto.');
  }

  const allMoney = [...text.matchAll(/(\d{1,5}[,.]\d{2})\s*€?/g)].map(m => parseFloat(m[1].replace(',','.'))).filter(n => n > 0 && n < 10000);
  const totalLine = text.match(/(?:TOTAL|IMPORTE|TARJETA|VISA|MASTERCARD|A PAGAR|PAGADO)[^\d]*(\d{1,5}[,.]\d{2})/i);
  const total = totalLine ? parseFloat(totalLine[1].replace(',','.')) : (allMoney.length ? Math.max(...allMoney) : 0);
  if (total && isFinite(total)) setField('total', total.toFixed(2), '');
  else markWarning('total', 'No he identificado el importe total.');

  const category = inferCategory(text);
  $('categoria').value = category;
  if (category === 'Revisar') markWarning('categoria', 'No he podido clasificar el tipo de gasto con seguridad.');

  const vatPct = text.match(/\b(21|10|4)\s*%/);
  if (vatPct) $('ivaTipo').value = vatPct[1];
  else markWarning('ivaTipo', 'No he identificado el porcentaje de IVA. Se mantiene el valor por defecto.');

  const explicitBase = findAmountAfter(text, ['BASE', 'B. IMP', 'BI']);
  const explicitVat = findAmountAfter(text, ['IVA', 'I.V.A']);
  if (explicitBase) setField('base', explicitBase.toFixed(2), '');
  if (explicitVat) setField('ivaCuota', explicitVat.toFixed(2), '');
  if (!explicitBase || !explicitVat) recalcVatFromTotal();

  $('formaPago').value = /efectivo|cash/i.test(text) ? 'Efectivo' : 'Tarjeta';

  const conf = Math.round(Number(confidence) || 0);
  $('observaciones').value = `OCR confianza aproximada: ${conf}%. Revisar campos marcados con advertencia y confirmar deducibilidad fiscal antes de liquidar IVA.`;
  renderWarnings();
}

function inferCategory(text){
  if (/restaurante|restaurant|bar|cafe|cafeter|comida|tapas|mes[oó]n/i.test(text)) return 'Restaurante / comidas';
  if (/taxi|cabify|uber|vtc/i.test(text)) return 'Taxi / VTC';
  if (/parking|aparcamiento/i.test(text)) return 'Parking';
  if (/peaje|autopista/i.test(text)) return 'Peajes';
  if (/hotel|hostal|alojamiento/i.test(text)) return 'Alojamiento';
  if (/gasolinera|combustible|diesel|gas[oó]leo|repsol|cepsa|bp/i.test(text)) return 'Combustible';
  if (/software|saas|subscription|licencia/i.test(text)) return 'Software / SaaS';
  return 'Revisar';
}

function findAmountAfter(text, labels){
  for (const label of labels) {
    const re = new RegExp(`${label}[^\\d]{0,15}(\\d{1,5}[,.]\\d{2})`, 'i');
    const m = text.match(re);
    if (m) return parseFloat(m[1].replace(',','.'));
  }
  return null;
}

function setField(id, value, warning){
  if (value !== null && value !== undefined && String(value).trim() !== '') $(id).value = value;
  else if (warning) markWarning(id, warning);
}

function markWarning(id, message){
  const field = document.querySelector(`[data-field="${id}"]`);
  if (field) {
    field.classList.add('needs-review');
    if (!field.querySelector('.warn-icon')) {
      const icon = document.createElement('button');
      icon.type = 'button';
      icon.className = 'warn-icon';
      icon.setAttribute('aria-label', message);
      icon.title = message;
      icon.textContent = '!';
      const span = field.querySelector('span');
      if (span) span.appendChild(icon);
    } else {
      const icon = field.querySelector('.warn-icon');
      icon.title = message; icon.setAttribute('aria-label', message);
    }
  }
  lastAutoFillWarnings.push({ field:id, message });
}

function clearWarnings(){
  lastAutoFillWarnings = [];
  document.querySelectorAll('.field.needs-review').forEach(el => el.classList.remove('needs-review'));
  document.querySelectorAll('.warn-icon').forEach(el => el.remove());
  $('fieldWarnings').classList.add('hidden');
  $('fieldWarnings').innerHTML = '';
}

function renderWarnings(){
  if (!lastAutoFillWarnings.length) { $('fieldWarnings').classList.add('hidden'); return; }
  const unique = [];
  const seen = new Set();
  for (const w of lastAutoFillWarnings) { if (!seen.has(w.message)) { unique.push(w); seen.add(w.message); } }
  $('fieldWarnings').innerHTML = `<strong>Campos a revisar</strong><ul>${unique.map(w => `<li>${escapeHtml(w.message)}</li>`).join('')}</ul>`;
  $('fieldWarnings').classList.remove('hidden');
}

function escapeHtml(s){ return String(s).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }

function recalcVatFromTotal(){
  const total = parseFloat($('total').value);
  const tipo = parseFloat($('ivaTipo').value);
  if (!isNaN(total) && !isNaN(tipo) && tipo >= 0) {
    const base = total / (1 + tipo / 100);
    $('base').value = base.toFixed(2);
    $('ivaCuota').value = (total - base).toFixed(2);
  }
}

function recalcVatFromBase(){
  const base = parseFloat($('base').value);
  const tipo = parseFloat($('ivaTipo').value);
  if (!isNaN(base) && !isNaN(tipo) && tipo >= 0 && !$('total').value) {
    const iva = base * tipo / 100;
    $('ivaCuota').value = iva.toFixed(2);
    $('total').value = (base + iva).toFixed(2);
  }
}

function resetForm(includeOcr=true){
  ['fecha','proveedor','nif','base','ivaCuota','total','motivo','proyecto','observaciones'].forEach(id => $(id).value = '');
  $('categoria').value = 'Revisar';
  $('ivaTipo').value = '21';
  $('formaPago').value = 'Tarjeta';
  $('estadoFiscal').value = 'Pendiente de revisión';
  if (includeOcr) $('ocrText').value = '';
  clearWarnings();
}

function loadExpenses(){ return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
function saveExpenses(rows){ localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); }
function normalizeName(s){ return (s || 'SIN_PROVEEDOR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'_').replace(/^_|_$/g,'').slice(0,36); }
function makeId(){ return 'G' + new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14); }
function num(id){ const v = parseFloat($(id).value); return isNaN(v) ? 0 : Math.round(v * 100) / 100; }
function extractConfidence(s){ const m = (s || '').match(/(\d+)%/); return m ? Number(m[1]) : ''; }

async function saveExpense(){
  const id = makeId();
  const fecha = $('fecha').value || new Date().toISOString().slice(0,10);
  const total = parseFloat($('total').value || 0).toFixed(2);
  const ext = currentBlob ? 'jpg' : 'sinimagen';
  const fileName = `${fecha}_${normalizeName($('categoria').value)}_${normalizeName($('proveedor').value)}_${String(total).replace('.', '-')}_${id}.${ext}`;
  if (currentDataUrl) localStorage.setItem(IMG_KEY_PREFIX + id, currentDataUrl);
  const estado = $('estadoFiscal').value;
  const row = {
    ID:id,
    'Fecha gasto':fecha,
    'Fecha registro':new Date().toISOString().slice(0,10),
    Proveedor:$('proveedor').value || 'No visible',
    'NIF proveedor':$('nif').value || 'No visible',
    Categoría:$('categoria').value,
    Descripción:($('ocrText').value || '').slice(0,180),
    'Base imponible':num('base'),
    'IVA %':num('ivaTipo'),
    'Cuota IVA':num('ivaCuota'),
    Total:num('total'),
    'Forma pago':$('formaPago').value,
    'Deducible IVA': estado.includes('deducible') && !estado.includes('no deducible') ? 'Sí' : (estado.includes('Pendiente') ? 'Revisar' : 'No'),
    'Deducible gasto': $('motivo').value ? 'Revisar/posible' : 'Revisar',
    'Motivo profesional':$('motivo').value,
    'Proyecto/cliente':$('proyecto').value,
    'Nombre archivo':fileName,
    'Ruta archivo':`localStorage:${IMG_KEY_PREFIX + id}`,
    'Estado fiscal':estado,
    'Confianza OCR':extractConfidence($('observaciones').value),
    Observaciones:$('observaciones').value,
    'Sincronización':'Pendiente Google Drive/Sheets',
    'Último error':'',
    'Drive Web URL':''
  };
  const rows = loadExpenses();
  rows.push(row);
  saveExpenses(rows);
  renderTable();
  setStatus(`Gasto ${id} guardado localmente. Sincronizando con Google...`);
  await syncExpense(id);
}

function renderTable(){
  const rows = loadExpenses();
  const thead = $('expensesTable').querySelector('thead tr');
  const tbody = $('expensesTable').querySelector('tbody');
  const mobile = $('mobileExpenseList');
  thead.innerHTML = ''; tbody.innerHTML = ''; mobile.innerHTML = '';
  COLUMNS.forEach(c => { const th = document.createElement('th'); th.textContent = c; thead.appendChild(th); });
  rows.forEach(r => {
    const tr = document.createElement('tr');
    COLUMNS.forEach(c => { const td = document.createElement('td'); fillCell(td, r, c); tr.appendChild(td); });
    tbody.appendChild(tr);
    const card = document.createElement('article'); card.className = 'expense-card';
    const h = document.createElement('h3'); h.textContent = `${r['Fecha gasto'] || ''} · ${r.Proveedor || 'Proveedor no visible'} · ${Number(r.Total || 0).toFixed(2)} €`; card.appendChild(h);
    const dl = document.createElement('dl');
    ['Categoría','Estado fiscal','Forma pago','Sincronización','Último error','Nombre archivo','Drive Web URL'].forEach(c => { const dt = document.createElement('dt'); dt.textContent = c; const dd = document.createElement('dd'); fillCell(dd, r, c); dl.append(dt, dd); });
    card.appendChild(dl); mobile.appendChild(card);
  });
}

function fillCell(el, r, c){
  if (c === 'Nombre archivo' && localStorage.getItem(IMG_KEY_PREFIX + r.ID)) {
    const a = document.createElement('a'); a.href = localStorage.getItem(IMG_KEY_PREFIX + r.ID); a.download = r['Nombre archivo']; a.textContent = r[c] || 'Ticket local'; el.appendChild(a);
  } else if (c === 'Drive Web URL' && r[c]) {
    const a = document.createElement('a'); a.href = r[c]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Abrir en Drive'; el.appendChild(a);
  } else el.textContent = r[c] ?? '';
}

async function safeJson(res){
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { ok:false, error:text.slice(0,500) || `HTTP ${res.status}` }; }
}

async function syncExpense(id){
  const rows = loadExpenses();
  const index = rows.findIndex(r => r.ID === id);
  if (index < 0) return;
  const row = rows[index];
  if (row['Sincronización'] === 'Sincronizado' && row['Drive Web URL']) return;
  const imageDataUrl = localStorage.getItem(IMG_KEY_PREFIX + id);
  if (!imageDataUrl) { row['Sincronización'] = 'Sin imagen local para subir'; row['Último error'] = 'No existe imagen en este dispositivo'; saveExpenses(rows); renderTable(); return; }
  try{
    const payload = JSON.stringify({ expense: row, imageDataUrl });
    if (payload.length > 3500000) throw new Error(`Imagen demasiado grande para Vercel (${fmtBytes(payload.length)}). Haz la foto más alejada o usa menor resolución.`);
    const res = await fetch(GOOGLE_SYNC_ENDPOINT, { method:'POST', headers:{'Content-Type':'application/json'}, body:payload });
    const data = await safeJson(res);
    if (data.driveUrl) {
      row['Ruta archivo'] = data.driveUrl;
      row['Drive Web URL'] = data.driveUrl;
    }
    if (!res.ok && !data.driveUrl) throw new Error(data.error || `HTTP ${res.status}`);
    if (data.sheetsAppended || data.ok) {
      row['Sincronización'] = 'Sincronizado';
      row['Último error'] = '';
      saveExpenses(rows); renderTable();
      setStatus(`Gasto ${id} sincronizado con Google Drive y Google Sheets.`, 'ok');
      return;
    }
    row['Sincronización'] = 'Imagen subida; hoja pendiente';
    row['Último error'] = data.sheetsError || data.error || 'La imagen subió, pero no se añadió la fila a Google Sheets.';
    saveExpenses(rows); renderTable();
    showDiag({ id, title:'Google Sheets pendiente', userMessage:'La imagen se ha subido a Drive, pero la fila no se ha añadido a Google Sheets.', error:row['Último error'], endpoint:GOOGLE_SYNC_ENDPOINT, response:data }, 'error');
    setStatus(`La imagen se ha subido, pero la fila de Google Sheets queda pendiente: ${row['Último error']}`, 'error');
  }catch(err){
    console.error(err);
    row['Sincronización'] = 'Pendiente'; row['Último error'] = err.message;
    saveExpenses(rows); renderTable();
    setStatus(`No se ha sincronizado con Google: ${err.message}`, 'error');
    showDiag({ id, title:'Sincronización pendiente', userMessage:'El gasto se ha guardado en este dispositivo, pero no se ha podido completar la sincronización. Revisa el detalle técnico o ejecuta Sincronizar pendientes desde Administración.', error:err.message, endpoint:GOOGLE_SYNC_ENDPOINT }, 'error');
  }
}

async function syncPending(){
  const pending = loadExpenses().filter(r => r['Sincronización'] !== 'Sincronizado').map(r => r.ID);
  if (!pending.length) { setStatus('No hay gastos pendientes de sincronizar.', 'ok'); return; }
  for (const id of pending) await syncExpense(id);
}

async function testGoogle(){
  setStatus('Probando conexión con Google...');
  try{
    const res = await fetch(`${GOOGLE_SYNC_ENDPOINT}?check=1`, { method:'GET' });
    const data = await safeJson(res);
    showDiag({ ...data, userMessage:data.ok ? 'La conexión con Google funciona. Drive y Google Sheets son accesibles.' : (data.error || data.notes || 'Hay incidencias de configuración.') }, data.ok ? 'ok' : 'error');
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setStatus('Conexión Google correcta.', 'ok');
  }catch(err){
    showDiag({ title:'Prueba Google fallida', userMessage:'No se ha podido verificar la conexión con Google. Revisa configuración OAuth, permisos de Drive/Sheets o variables de Vercel.', error:err.message }, 'error');
    setStatus(`La prueba Google ha fallado: ${err.message}`, 'error');
  }
}

function exportExcel(){
  const rows = loadExpenses(); if (!rows.length) { alert('No hay gastos para exportar.'); return; }
  const ws = XLSX.utils.json_to_sheet(rows, { header:COLUMNS }); ws['!cols'] = COLUMNS.map(c => ({ wch:Math.min(Math.max(c.length + 4, 14), 34) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
  const resumen = [['Indicador','Valor'],['Nº gastos',rows.length],['Total gastos',sum(rows,'Total')],['IVA soportado',sum(rows,'Cuota IVA')],['Pendientes revisión',rows.filter(r => String(r['Estado fiscal']).includes('Pendiente') || String(r['Deducible IVA']).includes('Revisar')).length]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen'); XLSX.writeFile(wb, `Jaccobson_Gastos_${new Date().toISOString().slice(0,10)}.xlsx`);
}
function sum(rows,k){ return rows.reduce((a,r) => a + (Number(r[k]) || 0), 0).toFixed(2); }
async function exportZip(){
  const rows = loadExpenses(); if (!rows.length) { alert('No hay gastos para exportar.'); return; }
  const zip = new JSZip(); rows.forEach(r => { const data = localStorage.getItem(IMG_KEY_PREFIX + r.ID); if (data) zip.file(r['Nombre archivo'], data.split(',')[1], { base64:true }); });
  const blob = await zip.generateAsync({ type:'blob' }); downloadBlob(blob, `Jaccobson_Tickets_${new Date().toISOString().slice(0,10)}.zip`);
}
function downloadBlob(blob, name){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

function clearCapture(){
  currentBlob = null; currentFile = null; currentDataUrl = null;
  $('cameraInput').value = ''; $('libraryInput').value = '';
  $('previewWrap').classList.add('hidden'); $('preview').removeAttribute('src');
  $('clearBtn').disabled = true; $('progress').classList.add('hidden'); $('progress').value = 0;
  $('originalName').textContent = '—'; $('originalType').textContent = '—'; $('originalSize').textContent = '—'; $('processedSize').textContent = '—';
  resetForm(true);
  setStatus('Captura y formulario limpiados.', 'ok');
}

function wipeAll(){
  if (!confirm('¿Borrar todos los gastos y tickets almacenados en este dispositivo?')) return;
  Object.keys(localStorage).filter(k => k.startsWith(IMG_KEY_PREFIX) || k === STORAGE_KEY || LEGACY_KEYS.includes(k)).forEach(k => localStorage.removeItem(k));
  renderTable();
}

init();
