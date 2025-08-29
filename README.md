# Bakery Loyalty Bot (WhatsApp + Google Sheets)

A minimal WhatsApp loyalty program: customers send messages to your WhatsApp; the bot verifies a daily PIN and adds points into Google Sheets.

## 1) Create Google Sheet
Create a spreadsheet with 4 sheets (tabs) named exactly:
- **Settings**: two columns only, like a key-value store
  - A1: EGP_PER_POINT | B1: 50
  - A2: DAILY_PIN     | B2: 1234
  - A3: MIN_BILL      | B3: 70
  - A4: DAILY_POINT_CAP | B4: 8

- **Customers**: `Phone | Name | Tier | Points | JoinedAt`

- **Txns**: `Phone | DateTime | Bill | PointsAdded | InvoiceRef | Cashier | DailyPIN | Note`

- **Rewards**: `Id | Title | CostPoints | Description`

Share the sheet with your service account email as **Editor**.

## 2) Google Cloud Service Account
- Create a project → enable "Google Sheets API"
- Create Service Account → create a JSON key
- Put JSON values into `.env`

## 3) WhatsApp Cloud API
- Create a Meta app, add "WhatsApp"
- Get **Phone Number ID** and a **User Access Token**
- Set Webhook URL to `https://<your-domain>/webhook` with the same `VERIFY_TOKEN` as `.env`
- Subscribe to `messages`

## 4) Run Locally
```bash
npm install
cp .env.example .env
# fill .env
node server.js
```

(Optional) Use `ngrok http 3000` and set the webhook to the public URL ngrok gives you.

## 5) Deploy
Use Railway / Render / Heroku / VPS:
- Create service
- Set **Environment Variables** from `.env`
- Deploy
- Set **Webhook** in Meta to your public `/webhook` endpoint

## 6) Commands
- `start` → show help
- `points` → show current balance and tier
- `add <bill> <PIN> [invoice]` → add points (daily PIN required)
- `rewards` → list rewards
- `redeem <id>` → redeem and receive a cashier code

## 7) Rotate Daily PIN
See `scripts/rotateDailyPIN.gs` and add a time-driven trigger in Apps Script.
