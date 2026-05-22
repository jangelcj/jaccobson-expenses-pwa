# Jaccobson Capital - Registro de gastos PWA - Google OAuth

Aplicacion web progresiva para iPhone orientada a capturar tickets, leerlos por OCR, guardar el justificante en Google Drive y registrar el gasto en Google Sheets.

## Cambio principal de esta version

Esta version usa OAuth con una cuenta Google personal. Ya no usa Service Account para subir archivos, porque las Service Accounts no tienen cuota de almacenamiento propia en Mi unidad.

## Variables de entorno en Vercel

Configura estas variables en Settings > Environment Variables:

```env
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
GOOGLE_OAUTH_REDIRECT_URI=https://TU-DOMINIO-VERCEL.vercel.app/api/google-oauth-callback
GOOGLE_REFRESH_TOKEN=se obtiene despues de conectar Google
GOOGLE_DRIVE_FOLDER_ID=id de la carpeta Tickets de Google Drive
GOOGLE_SHEETS_SPREADSHEET_ID=id del Google Sheets
GOOGLE_SHEETS_TAB_NAME=Gastos
```

## Configuracion en Google Cloud

1. Crea o usa un proyecto en Google Cloud.
2. Activa estas APIs:
   - Google Drive API
   - Google Sheets API
3. Configura la pantalla de consentimiento OAuth.
   - Tipo: Externa si es cuenta personal.
   - Modo de prueba: anade tu email como usuario de prueba.
4. Crea credenciales OAuth 2.0:
   - Tipo: Aplicacion web.
   - Authorized redirect URI:
     `https://TU-DOMINIO-VERCEL.vercel.app/api/google-oauth-callback`
5. Copia `client_id` y `client_secret` en Vercel.
6. Redeploy.

## Generar el refresh token

1. Abre la app desplegada.
2. Pulsa `Conectar Google`.
3. Autoriza con tu cuenta Google.
4. Copia el refresh token que aparecera en pantalla.
5. Pegalo en Vercel como `GOOGLE_REFRESH_TOKEN`.
6. Redeploy.
7. Pulsa `Probar Google`.

## Requisitos de Drive y Sheets

- Crea una carpeta en tu Google Drive, por ejemplo: `Jaccobson Capital/Gastos/Tickets`.
- Copia su ID de la URL y usalo como `GOOGLE_DRIVE_FOLDER_ID`.
- Crea un Google Sheets, por ejemplo: `Jaccobson Capital - Registro de Gastos`.
- Crea una pestana llamada exactamente `Gastos`.
- Copia el ID del fichero de la URL y usalo como `GOOGLE_SHEETS_SPREADSHEET_ID`.

## Despliegue

Sube todos los archivos a GitHub y conecta el repositorio con Vercel. Al hacer cambios en GitHub, Vercel redespliega automaticamente.

## Seguridad

No compartas el refresh token. Permite a la app subir archivos a Drive y escribir en Sheets en nombre de tu usuario Google.
