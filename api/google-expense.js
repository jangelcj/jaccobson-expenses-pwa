const { google } = require('googleapis');
const { Readable } = require('stream');
const crypto = require('crypto');

const COLUMNS = [
  'ID','Fecha gasto','Fecha registro','Proveedor','NIF proveedor','Categoría','Descripción','Base imponible','IVA %','Cuota IVA','Total','Forma pago','Deducible IVA','Deducible gasto','Motivo profesional','Proyecto/cliente','Nombre archivo','Ruta archivo','Estado fiscal','Confianza OCR','Observaciones','Drive File ID','Drive Web URL','Ticket Hash SHA-256','Confianza IA','Tipo documento','Riesgo fiscal','Acción recomendada'
];

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno en Vercel: ${name}`);
  return value;
}

function getOAuthClient() {
  const client = new google.auth.OAuth2(env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'), env('GOOGLE_OAUTH_REDIRECT_URI'));
  client.setCredentials({ refresh_token: env('GOOGLE_REFRESH_TOKEN') });
  return client;
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error('Imagen inválida: no llega como data URL base64');
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function asRow(expense, driveUrl, driveFileId, verifiedHash) {
  const row = { ...expense, 'Ruta archivo': driveUrl, 'Drive File ID': driveFileId, 'Drive Web URL': driveUrl };
  if (verifiedHash) row['Ticket Hash SHA-256'] = verifiedHash;
  return COLUMNS.map((column) => row[column] ?? '');
}

function httpError(error) {
  const primary = error && error.message ? error.message : '';
  const nested = error && error.errors && error.errors[0] ? error.errors[0].message : '';
  return [primary, nested].filter(Boolean).join(' | ') || 'Error desconocido';
}

function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function ensureHeaderRow(sheets, spreadsheetId, sheetName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets/properties/title' });
  const tabs = meta.data.sheets.map((s) => s.properties.title);
  if (!tabs.includes(sheetName)) {
    throw new Error(`La pestaña "${sheetName}" no existe en el Google Sheets. Pestañas disponibles: ${tabs.join(', ')}`);
  }
  const range = `${sheetName}!A1:${colLetter(COLUMNS.length)}1`;
  const current = await sheets.spreadsheets.values.get({ spreadsheetId, range }).catch(() => null);
  const firstRow = current && current.data && current.data.values ? current.data.values[0] : null;
  const needsUpdate = !firstRow || COLUMNS.some((c, i) => firstRow[i] !== c);
  if (needsUpdate) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [COLUMNS] }
    });
  }
}

async function appendSheetRow(sheets, spreadsheetId, sheetName, rowValues) {
  await ensureHeaderRow(sheets, spreadsheetId, sheetName);
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowValues] }
  });
  return response.data;
}

async function diagnostics(res) {
  const auth = getOAuthClient();
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });
  const folderId = env('GOOGLE_DRIVE_FOLDER_ID');
  const spreadsheetId = env('GOOGLE_SHEETS_SPREADSHEET_ID');
  const sheetName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Gastos';

  const [about, folder, spreadsheet] = await Promise.all([
    drive.about.get({ fields: 'user,storageQuota' }),
    drive.files.get({ fileId: folderId, fields: 'id,name,mimeType,capabilities/canAddChildren', supportsAllDrives: true }),
    sheets.spreadsheets.get({ spreadsheetId, fields: 'spreadsheetId,properties/title,sheets/properties/title' })
  ]);
  const tabs = spreadsheet.data.sheets.map((s) => s.properties.title);
  const hasTab = tabs.includes(sheetName);
  return res.status(200).json({
    ok: hasTab,
    authMode: 'OAuth usuario Google personal',
    googleUser: about.data.user || null,
    storageQuota: about.data.storageQuota || null,
    folder: folder.data,
    spreadsheet: { id: spreadsheet.data.spreadsheetId, title: spreadsheet.data.properties.title, tabs, expectedTab: sheetName, hasTab, columns:COLUMNS.length },
    notes: hasTab ? 'Configuración básica correcta. Se puede acceder a Drive y Google Sheets.' : `La pestaña ${sheetName} no existe en el Google Sheets.`
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try { return await diagnostics(res); }
    catch (error) { console.error(error); return res.status(500).json({ ok: false, error: httpError(error) }); }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { expense, imageDataUrl } = body || {};
    if (!expense || !expense.ID) throw new Error('Falta el payload del gasto');
    if (!imageDataUrl && !expense['Drive Web URL']) throw new Error('Falta la imagen del ticket');

    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });
    const folderId = env('GOOGLE_DRIVE_FOLDER_ID');
    const spreadsheetId = env('GOOGLE_SHEETS_SPREADSHEET_ID');
    const sheetName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Gastos';

    let driveFileId = expense['Drive File ID'] || '';
    let driveUrl = expense['Drive Web URL'] || '';
    let verifiedHash = expense['Ticket Hash SHA-256'] || '';

    if (!driveUrl) {
      const { mimeType, buffer } = decodeDataUrl(imageDataUrl);
      if (buffer.length > 2500000) throw new Error(`Imagen demasiado grande tras compresión: ${Math.round(buffer.length / 1024)} KB`);
      const serverHash = crypto.createHash('sha256').update(buffer).digest('hex');
      if (verifiedHash && verifiedHash !== serverHash) throw new Error('El hash SHA-256 calculado en servidor no coincide con el hash enviado por la app.');
      verifiedHash = serverHash;
      const fileName = expense['Nombre archivo'] || `${expense.ID}.jpg`;
      const created = await drive.files.create({
        requestBody: { name: fileName, parents: [folderId], mimeType },
        media: { mimeType, body: Readable.from(buffer) },
        fields: 'id, webViewLink',
        supportsAllDrives: true
      });
      driveFileId = created.data.id;
      driveUrl = created.data.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`;
    }

    let sheetsAppended = false;
    let sheetsResponse = null;
    let sheetsError = '';
    try {
      sheetsResponse = await appendSheetRow(sheets, spreadsheetId, sheetName, asRow(expense, driveUrl, driveFileId, verifiedHash));
      sheetsAppended = true;
    } catch (error) {
      sheetsError = httpError(error);
      console.error('Sheets append failed', error);
    }

    return res.status(sheetsAppended ? 200 : 207).json({ ok: sheetsAppended, driveFileId, driveUrl, ticketHash: verifiedHash, sheetsAppended, sheetsError, sheetsResponse });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: httpError(error) });
  }
};
