# Jaccobson Capital · Registro fiscal de gastos

Aplicación web progresiva (PWA) para iPhone orientada a capturar tickets, comprimir/convertir imágenes HEIC/HEIF, leer texto por OCR, registrar datos fiscales, archivar justificantes en Google Drive y añadir cada gasto a una hoja de cálculo de Google Sheets.

## Arquitectura

- **Frontend PWA**: `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`.
- **Backend Vercel Serverless**: `api/google-expense.js`.
- **Google Drive**: carpeta destino para tickets renombrados.
- **Google Sheets**: hoja maestra de gastos.

La integración con Google se ejecuta en el backend de Vercel para no exponer credenciales en el navegador del iPhone.

## Uso rápido en iPhone

1. Despliega el proyecto en Vercel.
2. Abre la URL HTTPS desde Safari.
3. Usa “Compartir” → “Añadir a pantalla de inicio”.
4. Captura el ticket con “Hacer foto o seleccionar ticket”.
5. Pulsa “Leer ticket”, revisa los campos y guarda.
6. Al guardar, la app intenta subir el ticket a Google Drive y añadir la fila a Google Sheets.
7. Si falla la conexión, el gasto queda localmente como pendiente y puede reintentarse con “Sincronizar pendientes”.

## Configuración de Google

### 1. Crear carpeta en Google Drive

Crea una carpeta, por ejemplo:

`Jaccobson Capital/Gastos/Tickets`

Copia el ID de carpeta desde la URL de Google Drive.

### 2. Crear hoja de cálculo

Crea una hoja de cálculo, por ejemplo:

`Jaccobson Capital - Libro de gastos`

Crea una pestaña llamada `Gastos` y añade esta cabecera en la fila 1:

```csv
ID,Fecha gasto,Fecha registro,Proveedor,NIF proveedor,Categoría,Descripción,Base imponible,IVA %,Cuota IVA,Total,Forma pago,Tarjeta últimos 4,Deducible IVA,Deducible gasto,Motivo profesional,Proyecto/cliente,Nombre archivo,Ruta archivo,Estado fiscal,Confianza OCR,Observaciones,Drive File ID,Drive Web URL
```

Copia el ID de la hoja desde la URL de Google Sheets.

### 3. Crear service account

En Google Cloud:

1. Crea o usa un proyecto.
2. Activa Google Drive API y Google Sheets API.
3. Crea una Service Account.
4. Genera una clave JSON.
5. Copia el email de la service account.
6. Comparte la carpeta de Drive y la hoja de cálculo con ese email como editor.

### 4. Variables de entorno en Vercel

Configura estas variables:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=tu-service-account@tu-proyecto.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_DRIVE_FOLDER_ID=id_de_la_carpeta_de_google_drive
GOOGLE_SHEETS_SPREADSHEET_ID=id_de_la_hoja_de_calculo
GOOGLE_SHEETS_TAB_NAME=Gastos
```

El fichero `.env.example` incluye la plantilla.

## Desarrollo local

```bash
npm install
cp .env.example .env.local
npx vercel dev
```

## Límites y recomendaciones

- La imagen se convierte/comprime antes de subirse para reducir tamaño y mejorar compatibilidad con iPhone.
- La función serverless recibe la imagen en base64; para volúmenes muy altos conviene migrar a carga directa/resumable upload.
- El OCR local es una primera capa funcional, pero no equivale a validación fiscal definitiva.
- Para producción conviene añadir autenticación, control de usuarios y una política de retención documental.

## Campos del registro

ID, fecha, proveedor, NIF, categoría, base imponible, IVA, total, pago por tarjeta, últimos 4 dígitos, deducibilidad, motivo profesional, proyecto, nombre del archivo, URL de Drive y observaciones fiscales.
