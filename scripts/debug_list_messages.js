const fs = require('fs');
const path = require('path');

// Load .env simple parser
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2];
    // remove surrounding quotes
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
}

const { createServices } = require('../lib/chatapp-evaluation-clients');
const { buildTranscript } = require('../lib/chatapp-evaluation');

async function run() {
  const services = createServices();
  const req = {
    chat_id: process.argv[2] || '559292239602',
    license_id: process.argv[3] || '76040',
    messenger_type: process.argv[4] || 'caWhatsApp'
  };
  console.log('Requesting messages for', req);
  try {
    const messages = await services.listMessages(req);
    console.log('MESSAGES_COUNT:', Array.isArray(messages) ? messages.length : 'not-array');
    const transcript = buildTranscript(messages, { responsibleId: process.argv[5] || '', responsibleName: process.argv[6] || '' , sessionClosedAt: process.argv[7] || '' });
    console.log('TRANSCRIPT_TARGET_HUMAN_MESSAGES:', transcript.targetHumanMessages, 'HAD_RELIABLE_BOUNDARY:', transcript.hadReliableBoundary);
    console.log('TRANSCRIPT_PREVIEW:\n', transcript.text.split('\n').slice(0,40).join('\n'));
    console.log('\n--- RAW MESSAGES (first 20) ---');
    console.log(JSON.stringify(messages.slice ? messages.slice(0,20) : messages, null, 2));
  } catch (err) {
    console.error('ERROR', err && err.code, err && err.statusCode, err && err.message);
    if (err && err.stack) console.error(err.stack);
  }
}

run();
