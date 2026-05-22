const { google } = require('googleapis');

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta variable de entorno en Vercel: ${name}`);
  return value;
}

module.exports = async function handler(req, res) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      env('GOOGLE_CLIENT_ID'),
      env('GOOGLE_CLIENT_SECRET'),
      env('GOOGLE_OAUTH_REDIRECT_URI')
    );

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    });

    res.writeHead(302, { Location: url });
    return res.end();
  } catch (error) {
    return res.status(500).send(`<pre>${String(error.message || error)}</pre>`);
  }
};
