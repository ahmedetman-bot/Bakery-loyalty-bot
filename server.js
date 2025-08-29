// server.js — bakery loyalty bot
import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

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

// ========== Google Sheet ==========
async function openDoc() {
  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
  const auth = new JWT({
    email: GOOGLE_SERVICE_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await doc.useJwtAuth(auth);
  await doc.loadInfo();
  return doc;
}

async function getSettings(doc) {
  const sheet = doc.sheetsByTitle['Settings'];
  await sheet.loadCells('A1:B10');
  const config = {};
  for (let r = 1; r < 10; r++) {
    const key = sheet.getCell(r, 0).value;
    const val = sheet.getCell(r, 1).value;
    if (!key) break;
    config[key.toString().trim()] = val?.toString().trim();
  }
  return {
    EGP_PER_POINT: Number(config['EGP PER POINT'] || 50),
    MIN_BILL: Number(config['MIN BILL'] || 70),
    DAILY_PIN: config['DAILY PIN'] || '',
    DAILY_POINT_CAP: Number(config['DAILY POINT CAP'] || 8),
  };
}

async function getOrCreateCustomer(doc, phone) {
  let sheet = doc.sheetsByTitle['Customers'];
  if (!sheet) {
    sheet = await doc.addSheet({
      title: 'Customers',
      headerValues: ['phone', 'points', 'visits', 'last_invoice', 'updated_at'],
    });
  }
  const rows = await sheet.getRows();
  let row = rows.find(r => (r.phone || '').toString() === phone);
  if (!row) {
    row = await sheet.addRow({
      phone,
      points: 0,
      visits: 0,
      last_invoice: '',
      updated_at: new Date().toISOString(),
    });
  }
  return { sheet, row };
}

async function addTxn(doc, { phone, amount, points, invoice }) {
  let sheet = doc.sheetsByTitle['Txns'];
  if (!sheet) {
    sheet = await doc.addSheet({
      title: 'Txns',
      headerValues: ['ts', 'phone', 'amount', 'points', 'invoice'],
    });
  }
  await sheet.addRow({
    ts: new Date().toISOString(),
    phone,
    amount,
    points,
    invoice,
  });
}

// ========== WhatsApp API ==========
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

    // start
    if (/^start$/i.test(text)) {
      await sendWhats(from, '👋 Welcome!\nUse:\n- `add 150 1234 INV001`\n- `points` to view your balance.');
      return res.sendStatus(200);
    }

    // points
    if (/^points$/i.test(text)) {
      const doc = await openDoc();
      const { row } = await getOrCreateCustomer(doc, from);
      await sendWhats(from, `⭐ You have ${row.points || 0} loyalty points.`);
      return res.sendStatus(200);
    }

    // add 150 1234 INV001
    const match = text.match(/^add\s+(\d+(?:\.\d+)?)\s+(\d+)\s+([\w\-]+)/i);
    if (match) {
      const amount = Number(match[1]);
      const pin = match[2];
      const invoice = match[3];

      const doc = await openDoc();
      const cfg = await getSettings(doc);

      if (pin !== cfg.DAILY_PIN) {
        await sendWhats(from, '❌ Invalid PIN.');
        return res.sendStatus(200);
      }

      if (amount < cfg.MIN_BILL) {
        await sendWhats(from, `⚠️ Min bill is ${cfg.MIN_BILL} EGP.`);
        return res.sendStatus(200);
      }

      let points = Math.floor(amount / cfg.EGP_PER_POINT);
      points = Math.min(points, cfg.DAILY_POINT_CAP);

      const { row } = await getOrCreateCustomer(doc, from);
      row.points = Number(row.points || 0) + points;
      row.visits = Number(row.visits || 0) + 1;
      row.last_invoice = invoice;
      row.updated_at = new Date().toISOString();
      await row.save();

      await addTxn(doc, { phone: from, amount, points, invoice });

      await sendWhats(
        from,
        `✅ Added.\n💰 Amount: ${amount} EGP\n🎯 Points earned: ${points}\n⭐ Total: ${row.points}`
      );
      return res.sendStatus(200);
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
