import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import { GoogleSpreadsheet } from 'google-spreadsheet';

const app = express();
app.use(bodyParser.json());

// --- WhatsApp helpers ---
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

async function sendText(to, text) {
  return axios.post(
    `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    },
    { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
  );
}

// --- Google Sheet init ---
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const doc = new GoogleSpreadsheet(SHEET_ID);
let sheetsReady = false;

async function initSheets() {
  if (sheetsReady) return;
  await doc.useServiceAccountAuth({ client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY });
  await doc.loadInfo();
  sheetsReady = true;
}

async function getSettings() {
  const sh = doc.sheetsByTitle['Settings'];
  const rows = await sh.getRows();
  const map = {};
  for (const r of rows) map[r._rawData[0]] = r._rawData[1];
  return {
    egpPerPoint: Number(map['EGP_PER_POINT'] || 50),
    dailyPIN: String(map['DAILY_PIN'] || ''),
    minBill: Number(map['MIN_BILL'] || 0),
    dailyCap: Number(map['DAILY_POINT_CAP'] || 999)
  };
}

async function findOrCreateCustomer(phone, name = '') {
  const sh = doc.sheetsByTitle['Customers'];
  const rows = await sh.getRows();
  let row = rows.find(r => (r.Phone || '').trim() === phone);
  if (!row) {
    await sh.addRow({ Phone: phone, Name: name, Tier: 'Bronze', Points: 0, JoinedAt: new Date().toISOString() });
    return { Phone: phone, Name: name, Tier: 'Bronze', Points: 0 };
  }
  return { Phone: row.Phone, Name: row.Name, Tier: row.Tier, Points: Number(row.Points || 0), _row: row };
}

async function updateCustomerPoints(phone, delta) {
  const sh = doc.sheetsByTitle['Customers'];
  const rows = await sh.getRows();
  const row = rows.find(r => (r.Phone || '').trim() === phone);
  if (!row) return;
  const newPts = Number(row.Points || 0) + delta;
  row.Points = newPts;
  if (newPts >= 50) row.Tier = 'Gold';
  else if (newPts >= 20) row.Tier = 'Silver';
  else row.Tier = 'Bronze';
  await row.save();
  return { points: newPts, tier: row.Tier };
}

async function addTxn({ phone, bill, pointsAdded, invoiceRef, cashier, dailyPIN }) {
  const sh = doc.sheetsByTitle['Txns'];
  await sh.addRow({
    Phone: phone,
    DateTime: new Date().toISOString(),
    Bill: bill,
    PointsAdded: pointsAdded,
    InvoiceRef: invoiceRef || '',
    Cashier: cashier || '',
    DailyPIN: dailyPIN || '',
    Note: ''
  });
}

async function getTodayPointsSum(phone) {
  const sh = doc.sheetsByTitle['Txns'];
  const rows = await sh.getRows({ limit: 1000 });
  const today = new Date().toISOString().slice(0,10);
  let sum = 0;
  rows.forEach(r => {
    if ((r.Phone || '').trim() === phone && (r.DateTime || '').slice(0,10) === today) {
      sum += Number(r.PointsAdded || 0);
    }
  });
  return sum;
}

async function listRewards() {
  const sh = doc.sheetsByTitle['Rewards'];
  const rows = await sh.getRows();
  return rows.map(r => ({
    id: String(r.Id).trim(),
    title: r.Title,
    cost: Number(r.CostPoints || 0),
    desc: r.Description || ''
  }));
}

// --- Webhook verification (GET) ---
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Incoming messages (POST) ---
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from; // phone
    const name = entry?.contacts?.[0]?.profile?.name || '';
    const text = (msg.text?.body || '').trim();

    await initSheets();
    const settings = await getSettings();

    await findOrCreateCustomer(from, name);
    const lower = text.toLowerCase();

    if (lower === 'start') {
      await sendText(from,
`👋 Welcome to [Bakery Name] Loyalty!
Commands:
- start (join)
- points (see your balance)
- add <bill> <PIN> [invoice]
- rewards (list rewards)
- redeem <id> (use a reward)`);
      return res.sendStatus(200);
    }

    if (lower === 'points') {
      const c = await findOrCreateCustomer(from, name);
      await sendText(from, `📊 Balance: ${c.Points} pts | Tier: ${c.Tier}`);
      return res.sendStatus(200);
    }

    if (lower === 'rewards') {
      const rewards = await listRewards();
      const lines = rewards.map(r => `${r.id}) ${r.title} – ${r.cost} pts`).join('\n');
      await sendText(from, `🎁 Rewards:\n${lines}\n\nUse: redeem <id>`);
      return res.sendStatus(200);
    }

    if (lower.startsWith('redeem')) {
      const parts = lower.split(/\s+/);
      const id = parts[1];
      if (!id) {
        await sendText(from, `Please specify reward id. Example: redeem 2`);
        return res.sendStatus(200);
      }
      const c = await findOrCreateCustomer(from, name);
      const rewards = await listRewards();
      const r = rewards.find(x => x.id === String(id));
      if (!r) {
        await sendText(from, `Invalid reward id.`);
        return res.sendStatus(200);
      }
      if (c.Points < r.cost) {
        await sendText(from, `Not enough points. You need ${r.cost} pts.`);
        return res.sendStatus(200);
      }
      await updateCustomerPoints(from, -r.cost);
      const redeemCode = Math.floor(100000 + Math.random()*900000).toString();
      await addTxn({ phone: from, bill: 0, pointsAdded: -r.cost, invoiceRef: `REDEEM-${redeemCode}`, cashier: 'WA', dailyPIN: '' });
      await sendText(from, `✅ Redeemed: ${r.title}\nShow this code at cashier (valid 10 min): ${redeemCode}`);
      return res.sendStatus(200);
    }

    if (lower.startsWith('add')) {
      const parts = text.split(/\s+/);
      const bill = Number(parts[1] || 0);
      const pin = String(parts[2] || '');
      const invoiceRef = parts[3] || '';

      if (!bill || !pin) {
        await sendText(from, `Usage:\nadd <bill> <PIN> [invoice]\nExample: add 175 9362 INV123`);
        return res.sendStatus(200);
      }

      if (pin !== settings.dailyPIN) {
        await sendText(from, `❌ Invalid or expired PIN. Ask the cashier for today's PIN.`);
        return res.sendStatus(200);
      }

      if (bill < settings.minBill) {
        await sendText(from, `❌ Min bill for points is EGP ${settings.minBill}.`);
        return res.sendStatus(200);
      }

      const todaySum = await getTodayPointsSum(from);
      const toAdd = Math.floor(bill / settings.egpPerPoint);
      if (todaySum + toAdd > settings.dailyCap) {
        const allowed = Math.max(0, settings.dailyCap - todaySum);
        if (allowed <= 0) {
          await sendText(from, `⚠️ You reached today's points cap (${settings.dailyCap} pts). Try again tomorrow.`);
          return res.sendStatus(200);
        }
      }

      await addTxn({ phone: from, bill, pointsAdded: toAdd, invoiceRef, cashier: 'WA', dailyPIN: pin });
      const updated = await updateCustomerPoints(from, toAdd);
      await sendText(from,
        `✅ Points added: ${toAdd} (Bill: EGP ${bill})\n` +
        `Balance: ${updated.points} pts | Tier: ${updated.tier}\n` +
        `🎁 Tip: reply "rewards" to see gifts`
      );
      return res.sendStatus(200);
    }

    await sendText(from, `Type "start" to see commands.`);
    return res.sendStatus(200);

  } catch (e) {
    console.error(e?.response?.data || e);
    return res.sendStatus(200);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Bot running on port', port));
