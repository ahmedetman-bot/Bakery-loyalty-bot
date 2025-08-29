import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const app = express();
app.use(bodyParser.json());

const {
  VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID,
  GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_EMAIL,
  GOOGLE_PRIVATE_KEY,
} = process.env;

// ✅ Webhook GET (Meta Verification)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// ✅ Webhook POST (رسائل واتساب)
app.post('/webhook', async (req, res) => {
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body;

    // ✅ سجل الزيارة في Google Sheet
    await logVisit(from, text);

    // ✅ رد على العميل
    await sendWhatsappText(from, '📌 تم تسجيل زيارتك بنجاح! شكراً ليك 🎉');

    return res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error in /webhook:', err);
    return res.sendStatus(500);
  }
});

// ✅ Send Message to WhatsApp
async function sendWhatsappText(to, body) {
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`;

  const response = await fetch(url, {
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

  const data = await response.json();
  console.log('📤 OUTGOING:', data);
}

// ✅ Log visits to Google Sheet
async function logVisit(phone, message) {
  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);

  const serviceAuth = new JWT({
    email: GOOGLE_SERVICE_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await doc.useJwtAuth(serviceAuth);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle['Visits'];
  await sheet.addRow({
    phone,
    message,
    date: new Date().toLocaleString('en-EG', { timeZone: 'Africa/Cairo' }),
  });

  console.log('📝 Visit saved to sheet');
}

// ✅ Base route
app.get('/', (req, res) => res.send('Bakery Loyalty Bot is running 🚀'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
