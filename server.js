// server.js
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const app = express();
app.use(bodyParser.json());

// ===== ENV =====
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'ahmedtoken123';
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const BAKERY_NAME = process.env.BAKERY_NAME || 'Le Blounger';

// ===== WhatsApp helper =====
async function sendText(to, body) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`;
  const res = await axios.post(
    url,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
    { headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' } }
  );
  console.log('OUT:', res.data);
  return res.data;
}

// ===== Google Sheets (v4 with JWT) =====
const auth = new JWT({
  email: SERVICE_EMAIL,
  key: PRIVATE_KEY,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const doc = new GoogleSpreadsheet(SHEET_ID, auth);

let sheetsReady = false;
async function initSheets() {
  if (sheetsReady) return;
  await doc.loadInfo(); // يحمل أسماء التابات
  sheetsReady = true;
}

// (اختياري) دوال سريعة للتعامل مع الشيت لو هتحتاج لاحقًا
async function findOrCreateCustomer(phone, name = '') {
  const sh = doc.sheetsByTitle['Customers'];
  const rows = await sh.getRows();
  let row = rows.find(r => (r.Phone || '').trim() === phone);
  if (!row) {
    await sh.addRow({ Phone: phone, Name: name, Tier: 'Bronze', Points: 0, JoinedAt: new Date().toISOString() });
    return { Phone: phone, Name: name, Tier: 'Bronze', Points: 0 };
  }
  return { Phone: row.Phone, Name: row.Name, Tier: row.Tier, Points: Number(row.Points || 0) };
}

// ===== Webhook verify (GET) =====
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ===== Webhook receive (POST) =====
app.post('/webhook', async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const name = change?.contacts?.[0]?.profile?.name || '';
    const text = (msg.text?.body || '').trim();
    const lower = text.toLowerCase();

    await initSheets();
    await findOrCreateCustomer(from, name); // مجرد تسجيل أول مرة

    if (lower === 'start') {
      const welcome =
        process.env.WELCOME_TEXT ||
        [
          `🎉 أهلاً بيك في ${BAKERY_NAME} 🎉`,
          '',
          'سعداء بزيارتك! من النهاردة هتكسب نقاط على كل عملية شراء.',
          '📌 مثال: كل 50 جنيه = 1 نقطة',
          '🎁 اجمع نقاطك واستبدلها بعروض وهدايا.',
          '',
          'اكتب: points (رصيدك) | rewards (الهدايا) | add <المبلغ> <PIN> لإضافة نقاط.',
        ].join('\n');
      await sendText(from, welcome);
      return res.sendStatus(200);
    }

    // رد افتراضي
    await sendText(from, 'اكتب "start" لعرض القائمة 👇');
    return res.sendStatus(200);
  } catch (e) {
    console.error('ERR:', e?.response?.data || e);
    return res.sendStatus(200);
  }
});

// Health
app.get('/', (_, res) => res.send('OK'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Bot running on', port));
