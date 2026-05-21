# Jaccobson Capital · PWA de gastos con Google Drive y Google Sheets

Versión corregida para iPhone y Vercel.

## Cambios principales

- Interfaz responsive para iPhone: formularios a una columna, tabla sustituida por tarjetas en móvil y botones táctiles.
- Compresión más agresiva de fotografías HEIC/JPEG antes de OCR y subida.
- Endpoint estable `/api/google-expense`.
- Botón **Probar Google** para diagnosticar variables de Vercel, acceso a carpeta Drive y acceso a Google Sheets.
- Muestra el error real de sincronización en pantalla y en la columna **Último error**.

## Variables necesarias en Vercel

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=tu-service-account@tu-proyecto.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_DRIVE_FOLDER_ID=id_de_la_carpeta_drive
GOOGLE_SHEETS_SPREADSHEET_ID=id_del_google_sheets
GOOGLE_SHEETS_TAB_NAME=Gastos
```

## Permisos imprescindibles

Comparte con el email de la Service Account, como Editor:

1. La carpeta de Google Drive donde se guardarán los tickets.
2. El fichero de Google Sheets donde se registrarán las filas.

Además, en Google Cloud deben estar habilitadas:

- Google Drive API.
- Google Sheets API.

## Diagnóstico

En la app pulsa **Probar Google**. Si todo está bien, devolverá:

- Email de la Service Account.
- Nombre e ID de la carpeta Drive.
- Nombre del Google Sheets.
- Pestañas detectadas.
- Confirmación de que existe la pestaña configurada, por defecto `Gastos`.

Si falla, el mensaje aparecerá en la pantalla y en el panel de diagnóstico.

## Despliegue

1. Sustituye los archivos del repositorio por esta versión.
2. Haz commit y push a GitHub.
3. Vercel redeplegará automáticamente.
4. En iPhone, abre la URL, fuerza recarga y prueba primero **Probar Google**.

