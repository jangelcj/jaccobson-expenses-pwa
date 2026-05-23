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

## Versión rediseñada UX móvil

Cambios incluidos:

- Menú hamburguesa superior con dos bloques: Ajustes y Administración.
- Ajustes contiene Conectar Google, Probar Google y diagnóstico legible con detalle técnico desplegable.
- Administración contiene Exportar Excel, Exportar ZIP, Sincronizar pendientes y Borrar datos locales.
- La lectura OCR se ejecuta automáticamente después de mostrar la previsualización del ticket.
- La pantalla principal queda centrada en el flujo diario: capturar ticket, revisar datos y guardar gasto.
- Service worker actualizado para forzar renovación de caché tras el despliegue.

Tras desplegar en Vercel, en iPhone conviene cerrar y volver a abrir la PWA. Si siguiera mostrando la versión anterior, abrir Safari, cargar la URL de Vercel y volver a añadir la app a pantalla de inicio.

## Cambios v4 UX y sincronización

- El botón **Limpiar captura** limpia también el formulario completo.
- Las secciones **Revisar datos fiscales** y **Libro de gastos** son contraíbles.
- El botón de captura permite elegir entre **cámara** y **fototeca**.
- El OCR se lanza automáticamente tras mostrar la previsualización.
- Los campos no identificados con seguridad por OCR se marcan con un icono de advertencia.
- El campo **Últimos 4 dígitos tarjeta** se sustituye por **Forma de pago** con Tarjeta por defecto.
- **Recalcular IVA** se ubica junto a **Total (€)** y descuenta el IVA del total usando el % seleccionado.
- La escritura en Google Sheets se ha reforzado: comprueba que exista la pestaña configurada, crea cabecera si la primera fila está vacía y añade la fila usando el rango `A1`.

Tras desplegar esta versión, recarga completamente la PWA en Safari. Si la tenías instalada en pantalla de inicio, puede ser necesario cerrarla desde el selector de apps y abrirla de nuevo para que el service worker actualice la caché.


## Lectura inteligente con Gemini

Esta versión añade un endpoint serverless `api/analyze-ticket.js`. La app envía la imagen comprimida a Vercel y Vercel la analiza con Gemini usando la variable `GEMINI_API_KEY`. Si Gemini falla, la app usa OCR local como respaldo.

Variables nuevas en Vercel:

```env
GEMINI_API_KEY=tu_api_key_de_google_ai_studio
GEMINI_MODEL=gemini-1.5-flash
```

No expongas la API Key en el navegador. Debe quedar solo en Vercel.
