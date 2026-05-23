function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno en Vercel: ${name}`);
  return value;
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error('Imagen inválida: no llega como data URL base64');
  return { mimeType: match[1], base64: match[2] };
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
  throw new Error('Gemini no devolvió JSON válido');
}

function httpError(error) {
  const primary = error && error.message ? error.message : '';
  const nested = error && error.error && error.error.message ? error.error.message : '';
  return [primary, nested].filter(Boolean).join(' | ') || 'Error desconocido';
}

function normalizeTicket(ticket) {
  const t = ticket || {};
  return {
    supplier: t.supplier || '',
    supplier_tax_id: t.supplier_tax_id || '',
    date: t.date || '',
    expense_type: t.expense_type || 'Revisar',
    taxable_base: t.taxable_base ?? null,
    vat_percent: t.vat_percent ?? null,
    vat_amount: t.vat_amount ?? null,
    total: t.total ?? null,
    payment_method: t.payment_method || 'Tarjeta',
    fiscal_status: t.fiscal_status || 'Pendiente de revisión',
    confidence: t.confidence ?? 0,
    warnings: Array.isArray(t.warnings) ? t.warnings : []
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'Método no permitido' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { imageDataUrl } = body || {};
    if (!imageDataUrl) throw new Error('Falta la imagen del ticket');
    const { mimeType, base64 } = decodeDataUrl(imageDataUrl);
    if (Buffer.byteLength(base64, 'base64') > 2500000) throw new Error('Imagen demasiado grande para analizar con Gemini. Reduce calidad o tamaño.');

    const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    const prompt = `Eres un asistente de precontabilización fiscal para una sociedad española. Analiza la imagen de un ticket, recibo o factura simplificada y devuelve exclusivamente JSON válido, sin markdown.

Objetivo: extraer datos para rellenar un formulario de gastos empresariales.

Reglas:
- No inventes datos. Si un dato no aparece con seguridad, usa cadena vacía o null y añade una advertencia.
- Normaliza fechas como YYYY-MM-DD.
- Importes en euros como números decimales, sin símbolo €.
- Si solo aparece total e IVA %, calcula taxable_base y vat_amount cuando sea coherente.
- Si hay varios importes, identifica el total fiscal, no propinas ni cambios.
- payment_method solo puede ser "Tarjeta" o "Efectivo". Si ves VISA, Mastercard, contactless, datáfono o tarjeta, usa "Tarjeta". Si no está claro, usa "Tarjeta".
- expense_type debe ser una de estas categorías: Restaurante / comidas, Taxi / VTC, Parking, Peajes, Alojamiento, Viajes, Combustible, Material oficina, Software / SaaS, Formación, Servicios profesionales, Representación comercial, Otros, Revisar.
- fiscal_status debe ser una de estas opciones: Factura completa, Factura simplificada deducible, Ticket/factura simplificada no deducible IVA, Pendiente de revisión.

Esquema exacto:
{
  "supplier": "",
  "supplier_tax_id": "",
  "date": "YYYY-MM-DD",
  "expense_type": "Revisar",
  "taxable_base": null,
  "vat_percent": null,
  "vat_amount": null,
  "total": null,
  "payment_method": "Tarjeta",
  "fiscal_status": "Pendiente de revisión",
  "confidence": 0.0,
  "warnings": []
}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env('GEMINI_API_KEY'))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json'
        }
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : `HTTP ${response.status}`;
      throw new Error(`Gemini API: ${msg}`);
    }

    const text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
      ? data.candidates[0].content.parts.map((p) => p.text || '').join('\n')
      : '';
    const parsed = normalizeTicket(extractJson(text));
    return res.status(200).json({ ok:true, provider:'Gemini', model, ticket: parsed, rawText: text, confidence: parsed.confidence });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok:false, error:httpError(error) });
  }
};
