# CLAUDE.md — Jaccobson Capital · Gastos

Briefing permanente del proyecto para futuras sesiones.

## Descripción

PWA para registro fiscal de gastos de empresa, pensada para una **sociedad española de un solo empleado** ("Jaccobson Capital"). Flujo: foto del ticket → análisis fiscal con IA (Gemini) → revisión en formulario → guardado local → sincronización con Google Drive (justificante) + Google Sheets (registro contable). Toda la UI y los mensajes están en español.

## Stack

- **Frontend**: HTML/CSS/JS plano, **sin framework ni build step**. Librerías por CDN (jsDelivr):
  - `heic2any` — conversión HEIC/HEIF → JPEG
  - `browser-image-compression` — reducción de tamaño antes de OCR/subida
  - `tesseract.js` — OCR local (fallback si Gemini falla)
  - `xlsx` (SheetJS) — exportación a Excel
  - `jszip` — exportación de tickets y paquete de asesoría en ZIP
- **Backend**: funciones serverless en **Vercel** (Node.js, CommonJS). Única dependencia de runtime: `googleapis`.
- **IA / OCR**: Google **Gemini** (`gemini-1.5-flash` por defecto) vía REST `generativelanguage.googleapis.com`.
- **Almacenamiento**: `localStorage` en el cliente; Google Drive + Google Sheets como destino sincronizado.
- **Persistencia local**: clave `jc_expenses_v8` (con migración automática desde `v1`–`v7`); imágenes bajo prefijo `jc_ticket_<ID>`.

## Estructura de archivos

```
jaccobson-expenses-pwa/
├── index.html              # UI: capturar → revisar → dashboard → libro de gastos
├── app.js                  # Toda la lógica de cliente (~753 líneas)
├── styles.css              # Estilos
├── manifest.webmanifest    # Manifiesto PWA
├── sw.js                   # Service worker (cache offline; ignora /api/)
├── vercel.json             # Config despliegue: maxDuration 30s en funciones IA/Google
├── package.json            # Dependencia googleapis; scripts usan `vercel dev`
├── README.md
├── icons/                  # icon-192.svg, icon-512.svg
└── api/                    # Funciones serverless de Vercel
    ├── analyze-ticket.js       # OCR + análisis fiscal con Gemini
    ├── google-expense.js       # Subida a Drive + fila en Sheets + diagnóstico (GET)
    ├── google-oauth-start.js   # Inicia consentimiento OAuth de Google
    └── google-oauth-callback.js# Intercambia código y muestra refresh_token
```

## Rutas API

| Ruta | Métodos | Función |
|---|---|---|
| `/api/analyze-ticket` | POST | Recibe `{ imageDataUrl }`, llama a Gemini con prompt fiscal, fuerza JSON, normaliza y devuelve el ticket estructurado. Límite ~2.5 MB de imagen. |
| `/api/google-expense` | GET / POST | **GET** = diagnóstico (verifica acceso a Drive, Sheets y existencia de la pestaña). **POST** = `{ expense, imageDataUrl }`; sube imagen a Drive, verifica hash SHA-256 en servidor, añade fila a Sheets (crea/valida cabecera). |
| `/api/google-oauth-start` | GET | Redirige (302) al consentimiento de Google. Scopes `drive` + `spreadsheets`, `access_type=offline`, `prompt=consent`. |
| `/api/google-oauth-callback` | GET | Intercambia el `code` por tokens y muestra el `refresh_token` en HTML para pegarlo manualmente en Vercel. |

Endpoints consumidos desde `app.js`: `GOOGLE_SYNC_ENDPOINT = '/api/google-expense'`, `GEMINI_ANALYZE_ENDPOINT = '/api/analyze-ticket'`.

### Códigos de respuesta relevantes
- `google-expense` POST devuelve **207** si la imagen se sube a Drive pero falla el `append` a Sheets (sincronización parcial). **200** si todo OK, **500** en error general, **405** método no permitido.

## Variables de entorno requeridas (en Vercel, sin valores)

| Variable | Usada por | Notas |
|---|---|---|
| `GEMINI_API_KEY` | analyze-ticket | obligatoria para análisis IA |
| `GEMINI_MODEL` | analyze-ticket | opcional; por defecto `gemini-1.5-flash` |
| `GOOGLE_CLIENT_ID` | google-expense, oauth-* | |
| `GOOGLE_CLIENT_SECRET` | google-expense, oauth-* | |
| `GOOGLE_OAUTH_REDIRECT_URI` | google-expense, oauth-* | |
| `GOOGLE_REFRESH_TOKEN` | google-expense | se genera una vez vía oauth-start → oauth-callback |
| `GOOGLE_DRIVE_FOLDER_ID` | google-expense | carpeta destino de los tickets |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | google-expense | hoja de cálculo destino |
| `GOOGLE_SHEETS_TAB_NAME` | google-expense | opcional; por defecto `Gastos` |

Todas las funciones usan un helper `env(name)` que lanza error explícito (`Falta variable de entorno en Vercel: ...`) si falta alguna obligatoria.

## Convenciones de nombrado

- **ID de gasto**: `makeId()` → `'G' + timestamp ISO compactado (YYYYMMDDHHMMSS)`, p. ej. `G20260610153000`.
- **Nombre de archivo del ticket**: `<fecha>_<categoria>_<proveedor>_<total con punto→guion>_<ID>.jpg` (o `.sinimagen`). Texto normalizado vía `normalizeName()`: sin acentos, `[^a-z0-9]→_`, máx. 36 chars.
- **Clave de imagen en localStorage**: `jc_ticket_<ID>` (`IMG_KEY_PREFIX`).
- **Clave de datos**: `jc_expenses_v8` (`STORAGE_KEY`); legacy `jc_expenses_v1..v7` (`LEGACY_KEYS`).
- **Cache del service worker**: `jc-expenses-v8` (`CACHE`).
- **Backend CommonJS**: `module.exports = async function handler(req, res)`. Helpers compartidos por archivo: `env()`, `decodeDataUrl()`, `httpError()`.
- **Versionado de app**: constantes `APP_VERSION` / `APP_VERSION_DATE` / `APP_CHANGES` en `app.js`, reflejadas en la sección "Acerca de" de `index.html`. Al subir versión, actualizar también `STORAGE_KEY`, `CACHE` (sw.js) y `ASSETS`.

## Categorías y estados fiscales (enums acordados frontend↔backend)

- **Categorías** (`CATEGORIES`): Restaurante / comidas, Taxi / VTC, Parking, Peajes, Alojamiento, Viajes, Combustible, Material oficina, Software / SaaS, Formación, Servicios profesionales, Representación comercial, Otros, Revisar.
- **Estado fiscal** (`ESTADOS`): Factura completa, Factura simplificada deducible, Ticket/factura simplificada no deducible IVA, Pendiente de revisión.
- **Forma de pago**: solo `Tarjeta` o `Efectivo` (por defecto `Tarjeta`).
- **IVA %**: 0, 4, 10, 21.
- Campos de análisis fiscal de Gemini (`vat_deductible`, `expense_deductible`): `Sí | No | Revisar`. `risk_level`: `Bajo | Medio | Alto | Revisar`.

## Estado actual

Las cuatro funciones de `/api` están **completas y operativas**. La app funciona end-to-end: captura, análisis IA con fallback a OCR local, guardado local, sincronización Google y exportaciones (Excel, ZIP de tickets, paquete de asesoría con manifiesto JSON + hashes SHA-256).

- Versión de app: **v8** (`2026-05-23`). `package.json` version: `1.2.0`.
- Rama principal: `main`. Despliegue por subida de archivos a GitHub (commits "Add files via upload").

## Observaciones / puntos a vigilar

1. **OAuth manual de un solo uso, monousuario.** El `refresh_token` se genera una vez y se pega a mano en Vercel. Toda la app opera con UNA cuenta de Google (la del propietario). No hay flujo multiusuario ni rotación automática de tokens.

2. **Desajuste de columnas frontend vs. backend.**
   - `app.js` `COLUMNS` = **29** columnas e incluye `Sincronización` y `Último error` (estado puramente local).
   - `google-expense.js` `COLUMNS` = **28** columnas: NO incluye esas dos, y ordena de forma distinta (`Estado fiscal`, `Confianza OCR`, `Observaciones`, luego `Drive File ID`, `Drive Web URL`, `Ticket Hash SHA-256`, `Confianza IA`, ...).
   - El backend mapea **por nombre** (`asRow` + objeto `row`), así que hoy funciona, pero los dos arrays no son idénticos. **Si se añaden/renombran columnas hay que sincronizar ambos a mano** o las que falten quedarán vacías en Sheets.

3. **Fallback de IA.** Si `/api/analyze-ticket` falla (p. ej. falta `GEMINI_API_KEY` o error de cuota), el cliente cae automáticamente a OCR local con Tesseract (`runOcr`). La app sigue usable sin Gemini, con menor calidad de extracción.

4. **Sincronización tolerante a fallos.** Tres estados posibles: `Sincronizado`, `Imagen subida; hoja pendiente` (respuesta 207), `Pendiente`. Reintento manual desde "Sincronizar pendientes".

5. **Integridad documental.** Se calcula hash SHA-256 del ticket en cliente (`sha256Blob`) y se **reverifica en servidor** antes de subir a Drive; si no coinciden, la subida falla. El hash viaja a Sheets y al manifiesto del paquete de asesoría.

6. **Límites de tamaño.** Imagen: ~2.5 MB tras compresión (validado en cliente y servidor). Payload total a Vercel: ~3.5 MB (validado en `syncExpense`). La compresión en cliente apunta a ≤0.85 MB / 1600px, con segunda pasada más agresiva si supera 1.2 MB.

7. **Service worker ignora `/api/`** deliberadamente (las llamadas a API siempre van a red). Solo cachea assets estáticos listados en `ASSETS`.

8. **Sin tests ni linting.** No hay suite de pruebas ni configuración de CI. Cambios se validan manualmente / con `vercel dev`.

9. **Validez del análisis fiscal.** El prompt de Gemini advierte explícitamente que NO es asesoramiento definitivo; los campos quedan como ayuda y deben revisarse antes de liquidar IVA.

## Desarrollo local

```bash
npm install
npm run dev   # = vercel dev (sirve la PWA + las funciones de /api)
```

Requiere las variables de entorno listadas arriba para que las rutas `/api` funcionen.

## Hoja de ruta

Mejoras propuestas, ordenadas por prioridad. No existe un roadmap formal en el repo (el README es un changelog por versiones); las mejoras funcionales de abajo son propuestas alineadas con la dirección del proyecto y los huecos detectados.

### P0 — Bugs / inconsistencias detectadas (corregir primero)

1. **Unificar las listas de columnas (frontend ↔ backend).** `app.js` `COLUMNS` (29) y `google-expense.js` `COLUMNS` (28) difieren en contenido y orden. Hoy funciona porque el backend mapea por nombre, pero es frágil: extraer la lista a una única fuente de verdad (o documentar el contrato y añadir una comprobación) para que `Sincronización`/`Último error` y el resto queden consistentes y no se generen celdas vacías al evolucionar el esquema. (Ver Observación 2.)

2. **Riesgo de cuota de `localStorage`.** Las imágenes (data URL base64) se guardan íntegras en `localStorage` bajo `jc_ticket_<ID>`. En iOS el límite es ~5 MB por origen: con pocos tickets se puede superar y `setItem` lanzará `QuotaExceededError` sin manejo actual (en `saveExpense` y `analyzeTicket`/guardado). Añadir captura de error, aviso al usuario y/o migración a IndexedDB.

3. **Migración de storage incompleta.** `migrateStorage()` copia el array de gastos desde claves legacy, pero NO migra las imágenes asociadas (`jc_ticket_*` de versiones previas no se renombran). Verificar que los IDs se conservan entre versiones y que las imágenes legacy siguen resolviéndose.

4. **Validación de entrada en el backend.** `analyze-ticket` y `google-expense` confían en el `body`. Reforzar validación de tipos/tamaño y mensajes de error, y revisar el límite de 2.5 MB duplicado en cliente y servidor para mantenerlos sincronizados.

### P1 — Robustez y mantenibilidad

5. **Modelo Gemini desactualizado.** `gemini-1.5-flash` es el default. Evaluar migrar a un modelo vigente y dejar el `GEMINI_MODEL` documentado como punto único de cambio.

6. **Sincronización idempotente / deduplicación.** Reintentos de `syncExpense` podrían crear duplicados en Drive/Sheets si una subida tiene éxito parcial. Usar el hash SHA-256 o el `ID` para detectar duplicados antes de hacer `append`.

7. **Tests mínimos y CI.** No hay pruebas. Añadir tests unitarios para las funciones puras de `app.js` (`normalizeDateValue`, `normalizeNumber`, `normalizeCategory`, `recalcVat*`, `makeId`, `normalizeName`) y para los normalizadores del backend.

8. **Manejo de versionado centralizado.** Subir versión hoy exige tocar `APP_VERSION`, `STORAGE_KEY`, `CACHE` y `ASSETS` por separado. Documentado en Convenciones, pero conviene un checklist o script que lo haga atómico.

### P2 — Mejoras funcionales

9. **Edición y borrado de gastos individuales.** Actualmente solo se puede añadir o borrar todo (`wipeAll`). Permitir editar/eliminar una fila del libro y re-sincronizar.

10. **Filtros y búsqueda en el libro de gastos** (por fecha, categoría, estado de sincronización, proveedor).

11. **Exportación por rango de fechas / trimestre fiscal**, para encajar con liquidaciones de IVA trimestrales (modelo 303).

12. **Resumen fiscal por trimestre/categoría** en el dashboard (IVA soportado deducible vs. no deducible, totales por trimestre).

13. **Detección de duplicados de ticket** en cliente avisando si un hash SHA-256 ya existe antes de guardar.

### P3 — Mayor alcance

14. **Soporte multiusuario / multi-cuenta Google** (hoy es monousuario con refresh_token manual; ver Observación 1).

15. **Conciliación bancaria / importación de movimientos** para casar gastos con cargos.

16. **Backup/restore de los datos locales** (export/import JSON completo, no solo Excel).
