const { google } = require('googleapis');

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno en Vercel: ${name}`);
  return value;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

module.exports = async function handler(req, res) {
  try {
    if (req.query.error) throw new Error(req.query.error);
    const code = req.query.code;
    if (!code) throw new Error('Google no ha devuelto código OAuth.');

    const oauth2Client = new google.auth.OAuth2(
      env('GOOGLE_CLIENT_ID'),
      env('GOOGLE_CLIENT_SECRET'),
      env('GOOGLE_OAUTH_REDIRECT_URI')
    );
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error('Google no ha devuelto refresh_token. Vuelve a abrir /api/google-oauth-start con prompt=consent o elimina el consentimiento anterior de la app en tu cuenta Google.');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google conectado</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#F6F4EF;color:#0F2034;padding:24px;line-height:1.45}.box{max-width:860px;margin:auto;background:white;border:1px solid #D9DEE7;border-radius:18px;padding:22px}code,textarea{width:100%;box-sizing:border-box}textarea{min-height:130px;border:1px solid #D9DEE7;border-radius:12px;padding:12px;font:13px ui-monospace,monospace}h1{font-family:Georgia,serif}.ok{color:#1FA463;font-weight:800}</style></head><body><main class="box"><p class="ok">Google OAuth conectado correctamente.</p><h1>Refresh token generado</h1><p>Copia este valor completo y pégalo en Vercel como variable <strong>GOOGLE_REFRESH_TOKEN</strong>. Después haz redeploy del proyecto.</p><textarea readonly onclick="this.select()">${esc(tokens.refresh_token)}</textarea><p>Por seguridad, no compartas este token. Permite a la app acceder a Drive y Sheets con tu cuenta.</p></main></body></html>`);
  } catch (error) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`<pre>${esc(error.message || error)}</pre>`);
  }
};
