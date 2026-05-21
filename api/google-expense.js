const { google } = require('googleapis');

const COLUMNS = [
  'ID','Fecha gasto','Fecha registro','Proveedor','NIF proveedor','Categoría','Descripción','Base imponible','IVA %','Cuota IVA','Total','Forma pago','Tarjeta últimos 4','Deducible IVA','Deducible gasto','Motivo profesional','Proyecto/cliente','Nombre archivo','Ruta archivo','Estado fiscal','Confianza OCR','Observaciones','Drive File ID','Drive Web URL'
];

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function getPrivateKey() {
  return env('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n');
}

function getAuth() {
  return new google.auth.JWT({
    email: env('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    key: getPrivateKey(),
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data URL');
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function asRow(expense, driveUrl, driveFileId) {
  const row = { ...expense, 'Ruta archivo': driveUrl, 'Drive File ID': driveFileId, 'Drive Web URL': driveUrl };
  return COLUMNS.map((column) => row[column] ?? '');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { expense, imageDataUrl } = body || {};
    if (!expense || !expense.ID) throw new Error('Missing expense payload');
    if (!imageDataUrl) throw new Error('Missing imageDataUrl');

    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });
    const { mimeType, buffer } = decodeDataUrl(imageDataUrl);

    const fileName = expense['Nombre archivo'] || `${expense.ID}.jpg`;
    const folderId = env('GOOGLE_DRIVE_FOLDER_ID');
    const spreadsheetId = env('GOOGLE_SHEETS_SPREADSHEET_ID');
    const sheetName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Gastos';

    const mediaStream = require('stream').Readable.from(buffer);
    const created = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId], mimeType },
      media: { mimeType, body: mediaStream },
      fields: 'id, webViewLink'
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
    return res.status(500).json({ ok: false, error: error.message });
  }
};
