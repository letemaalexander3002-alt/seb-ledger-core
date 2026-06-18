# SEB-Ledger Core
## The Pan-East African Informal Sector Economic Ledger

> **Intellectual Property of Founder Alexander Eliud Letema**
> Letema Group (Tech Division) — Sovereign Ecosystem Blueprint (SEB)

---

## Overview

The SEB-Ledger Core is a production-ready micro-service API that serves as the backbone of the **Sovereign Ecosystem Blueprint** — a financial infrastructure layer for the informal sector across Tanzania and Pan-East Africa.

### What it does

| Engine | Function |
|---|---|
| **Webhook Engine** | Receives mobile-money transaction events (AzamPay, M-Pesa, Tigo, Airtel), applies tax slices, writes to ledger |
| **AI Credit Engine** | Computes Cognitive Credit Scores (0–100) from 30-day transaction history |
| **Governance Dashboard** | Aggregates real-time statistics across the entire ledger for state-level oversight |

### Production hardening

- Input validation and sanitization on every route (phone normalization, 19-digit NIDA format check, XSS-safe text fields)
- Security headers via `helmet`, configurable CORS allowlist for production
- Rate limiting: 300 req / 15 min general, 60 req / min on the webhook endpoint
- Request body size capped at 100kb
- Optional `X-Admin-Key` gate on the governance dashboard (`ADMIN_API_KEY` env var)
- Internal errors are logged server-side but never leaked to API responses
- Graceful shutdown on SIGTERM/SIGINT, process-level crash guards

---

## Architecture

```
seb-ledger-core/
├── package.json        # Node.js project manifest & dependencies
├── .env.example        # Environment variable template
├── server.js           # Core execution engine (Express.js API)
├── database.sql        # Supabase PostgreSQL DDL schema
├── README.md           # This file
└── package-zip.js      # Auto-packager script (no npm deps)
```

**Stack:** Node.js · Express.js · Supabase PostgreSQL · @supabase/supabase-js

---

## Termux Installation Guide

### Step 1 — Prepare Termux Environment

```bash
# Update and upgrade all packages
pkg update && pkg upgrade -y

# Install Node.js (includes npm)
pkg install nodejs -y

# Verify installation
node --version
npm --version
```

### Step 2 — Transfer the ZIP File

```bash
# Grant Termux storage access (run once)
termux-setup-storage

# If you downloaded seb-ledger-core.zip to your Android Downloads folder:
cp ~/storage/downloads/seb-ledger-core.zip ~/

# Navigate to home directory
cd ~
```

### Step 3 — Extract the Package

```bash
# Install unzip if not already available
pkg install unzip -y

# Extract the archive
unzip seb-ledger-core.zip

# Enter the project directory
cd seb-ledger-core
```

### Step 4 — Configure Environment

```bash
# Copy the example env file
cp .env.example .env

# Edit the .env file with your Supabase credentials
# Use nano (install if needed: pkg install nano -y)
nano .env
```

Inside `.env`, set:

```env
PORT=3000
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Production hardening (see .env.example for full descriptions)
NODE_ENV=production
ALLOWED_ORIGINS=https://app.sebledger.tz
ADMIN_API_KEY=choose-a-long-random-secret
```

Save and exit nano: `Ctrl+O`, `Enter`, `Ctrl+X`

### Step 5 — Initialise the Database

1. Open your **Supabase Dashboard** in a browser
2. Navigate to **SQL Editor**
3. Open `database.sql` and copy the entire contents
4. Paste into the SQL Editor and click **Run**

This creates the `merchants`, `transactions`, and `credit_scores` tables with indexes, triggers, and seed data.

### Step 6 — Install Dependencies

```bash
# Install all npm packages
npm install
```

### Step 7 — Start the Engine

```bash
# Boot the SEB-Ledger Core
node server.js
```

You should see:

```
╔══════════════════════════════════════════════════════════╗
║     SEB-LEDGER CORE — ENGINE ONLINE                     ║
║     Pan-East African Informal Sector Economic Ledger     ║
╚══════════════════════════════════════════════════════════╝
  Local:   http://localhost:3000
```

---

## API Reference

### Health Check

```http
GET /health
```

---

### List Merchants

```http
GET /api/v1/merchants?search=&region=&page=1&page_size=20
```

All query params are optional. `search` matches against `full_name` or `phone_number` (case-insensitive). `page_size` is capped at 100.

**Response:**
```json
{
  "success": true,
  "count": 20,
  "total": 142,
  "page": 1,
  "page_size": 20,
  "total_pages": 8,
  "merchants": [ /* ... */ ]
}
```

---

### Register Merchant

```http
POST /api/v1/merchants
Content-Type: application/json

{
  "full_name": "Amina Salim Juma",
  "phone_number": "0712345678",
  "business_type": "Food Vendor",
  "region": "Dar es Salaam",
  "district": "Kinondoni",
  "nida_number": "19901205-00001-00001-1"
}
```

---

### Mobile Money Webhook

```http
POST /api/v1/webhooks/mobile-money
Content-Type: application/json

{
  "phone_number": "0712345678",
  "reference_id": "MPESA-TXN-20240617-001",
  "gross_amount": 25000,
  "currency": "TZS",
  "channel": "MPESA"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Transaction processed and recorded in the SEB-Ledger.",
  "ledger_entry": {
    "transaction_id": "uuid...",
    "gross_amount": 25000,
    "tax_deducted": 100,
    "net_amount": 24900,
    "status": "COMPLETED"
  }
}
```

---

### Cognitive Credit Score

```http
GET /api/v1/analytics/cognitive-score/:merchant_id
```

**Response:**
```json
{
  "success": true,
  "report": {
    "score_card": {
      "cognitive_score": 74.5,
      "score_tier": "ESTABLISHED",
      "loan_limit_tzs": 1500000
    },
    "engine_details": {
      "score_breakdown": {
        "frequency": 22,
        "volume": 18,
        "consistency": 20,
        "completion": 18
      },
      "model_version": "SEB-AI-v1.0-MOCK"
    }
  }
}
```

**Score Tiers:**

| Score | Tier | Description |
|---|---|---|
| 80–100 | SOVEREIGN | Premium tier — full loan access |
| 60–79 | ESTABLISHED | Strong track record |
| 40–59 | GROWING | Active, building history |
| 20–39 | EMERGING | Early stage |
| 0–19 | UNRATED | Insufficient data |

---

### Governance Dashboard

```http
GET /api/v1/governance/dashboard
```

Returns total revenue, tax collected, active merchants, regional breakdown, and credit tier distribution.

If `ADMIN_API_KEY` is set in the environment, this route requires a matching `X-Admin-Key` header, since it exposes ledger-wide financial aggregates.

---

## Re-Packaging for Transfer

To generate a fresh ZIP from within the project:

```bash
node package-zip.js
# or: npm run zip
# Outputs: seb-ledger-core_<timestamp>.zip in the current directory
# (excludes node_modules, .env, .git automatically)
```

---

## Quick Test Commands (curl in Termux)

```bash
# 1. Health check
curl http://localhost:3000/health

# 2. List merchants
curl http://localhost:3000/api/v1/merchants

# 3. Send a test transaction
curl -X POST http://localhost:3000/api/v1/webhooks/mobile-money \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"0712000001","reference_id":"TEST-001","gross_amount":50000,"channel":"MPESA"}'

# 4. View dashboard
curl http://localhost:3000/api/v1/governance/dashboard
```

---

## License

Proprietary. All rights reserved.
**© Alexander Eliud Letema — Letema Group (Tech Division)**
Sovereign Ecosystem Blueprint (SEB) — Tanzania & Pan-East Africa
