const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadEnvFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2];
    // remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1]] = val;
  }
  return env;
}

function base64url(v) { return Buffer.from(v).toString('base64url'); }
function sanitizePrivateKey_(value) {
  if (!value) return value;
  let v = String(value).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  v = v.replace(/\\n/g, '\n');
  return v;
}

(async function(){
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) { console.error('.env not found'); process.exit(1); }
  const env = loadEnvFile(envPath);
  const rawKey = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!rawKey) { console.error('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY missing in .env'); process.exit(1); }
  const privateKey = sanitizePrivateKey_(rawKey);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now()/1000);
  const claim = base64url(JSON.stringify({ iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'test@example.com', scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const toSign = Buffer.from(header + '.' + claim, 'utf8');
  try {
    const sig = crypto.sign('sha256', toSign, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING });
    console.log('Signature length:', sig.length);
    console.log('First 64 bytes (base64):', sig.slice(0,64).toString('base64'));
    console.log('Base64url signature:', Buffer.from(sig).toString('base64url').slice(0,80));
    console.log('OK');
  } catch (err) {
    console.error('SIGN ERROR', err && (err.message || err.code) || err);
    console.error(err);
    process.exit(2);
  }
})();
