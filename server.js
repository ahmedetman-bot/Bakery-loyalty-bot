const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const GoogleSpreadsheet = require('google-spreadsheet');

const app = express();
app.use(bodyParser.json());

const {
  PORT = 3000,
  VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID,
  GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_EMAIL,
  GOOGLE_PRIVATE_KEY,
} = process.env;

// ========== Google Sheet - V2 ==========
async function openDoc() {
  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);

  await new Promise((resolve, reject) => {
    doc.useServiceAccountAuth(
      {
        client_email: GOOGLE_SERVICE_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      (err) => (err ? reject(err) : resolve())
    );
  });

  const info = await new Promise((resolve, reject) => {
    doc.getInfo((err, info) => (err ? reject(err) : resolve(info)));
  });

  return info;
}

// ========== WhatsApp ==========
async function sendWhats(to, body) {
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });
  const data = await res.json();
  console.log('OUT:', data);
}

// ========== Webhook ==========
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = (msg.text?.body || '').trim();
    console.log('IN:', from, text);

    if (/^start$/i.test(text)) {
      await sendWhats(from, '👋 Welcome!\nReply with `points` to check points.');
      return res.sendStatus(200);
    }

    if (/^points$/i.test(text)) {
      const info = await openDoc();
      const sheet = info.worksheets.find(w => w.title === 'Customers');
      sheet.getRows((err, rows) => {
        const row = rows.find(r => r.phone === from);
        const pts = row?.points || 0;
        sendWhats(from, `⭐ You have ${pts} points`);
        return res.sendStatus(200);
      });
      return;
    }

    await sendWhats(from, '🤖 I didn’t understand.\nType `start`.');
    return res.sendStatus(200);
  } catch (e) {
    console.error('ERR:', e);
    return res.sendStatus(200);
  }
});

// ========== Health check ==========
app.get('/', (_, res) => res.send('✅ Bot running'));

app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`);
});
