const { google } = require('googleapis');
const { Readable } = require('stream');

const COLUMNS = [
  'ID','Fecha gasto','Fecha registro','Proveedor','NIF proveedor','Categoría','Descripción','Base imponible','IVA %','Cuota IVA','Total','Forma pago','Tarjeta últimos 4','Deducible IVA','Deducible gasto','Motivo profesional','Proyecto/cliente','Nombre archivo','Ruta archivo','Estado fiscal','Confianza OCR','Observaciones','Drive File ID','Drive Web URL'
];

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno en Vercel: ${name}`);
  return value;
}

function getOAuthClient() {
  const client = new google.auth.OAuth2(
    env('GOOGLE_CLIENT_ID'),
    env('GOOGLE_CLIENT_SECRET'),
    env('GOOGLE_OAUTH_REDIRECT_URI')
  );
  client.setCredentials({ refresh_token: env('GOOGLE_REFRESH_TOKEN') });
  return client;
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error('Imagen inválida: no llega como data URL base64');
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function asRow(expense, driveUrl, driveFileId) {
  const row = { ...expense, 'Ruta archivo': driveUrl, 'Drive File ID': driveFileId, 'Drive Web URL': driveUrl };
  return COLUMNS.map((column) => row[column] ?? '');
}

function httpError(error) {
  const g = error && error.errors && error.errors[0] ? error.errors[0].message : '';
  const msg = [error.message, g].filter(Boolean).join(' | ');
  return msg || 'Error desconocido';
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
  const tabs = spreadsheet.data.sheets.map(s => s.properties.title);
  const hasTab = tabs.includes(sheetName);
  return res.status(200).json({
    ok: true,
    authMode: 'OAuth usuario Google personal',
    googleUser: about.data.user || null,
    storageQuota: about.data.storageQuota || null,
    folder: folder.data,
    spreadsheet: { id: spreadsheet.data.spreadsheetId, title: spreadsheet.data.properties.title, tabs, expectedTab: sheetName, hasTab },
    notes: hasTab ? 'Configuración básica correcta.' : `La pestaña ${sheetName} no existe en el Google Sheets.`
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
    if (!imageDataUrl) throw new Error('Falta la imagen del ticket');

    const auth = getOAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });
    const { mimeType, buffer } = decodeDataUrl(imageDataUrl);

    if (buffer.length > 2500000) throw new Error(`Imagen demasiado grande tras compresión: ${Math.round(buffer.length/1024)} KB`);

    const fileName = expense['Nombre archivo'] || `${expense.ID}.jpg`;
    const folderId = env('GOOGLE_DRIVE_FOLDER_ID');
    const spreadsheetId = env('GOOGLE_SHEETS_SPREADSHEET_ID');
    const sheetName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Gastos';

    const created = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId], mimeType },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id, webViewLink',
      supportsAllDrives: true
    });

    const driveFileId = created.data.id;
    const driveUrl = created.data.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [asRow(expense, driveUrl, driveFileId)] }
    });

    return res.status(200).json({ ok: true, driveFileId, driveUrl });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: httpError(error) });
  }
};
