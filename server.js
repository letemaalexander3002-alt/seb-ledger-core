'use strict';

/**
 * ============================================================
 *  SEB-LEDGER CORE — Primary Execution Engine v1.1.0
 *  The Pan-East African Informal Sector Economic Ledger
 *
 *  Intellectual Property of Founder Alexander Eliud Letema
 *  Letema Group (Tech Division) — Sovereign Ecosystem Blueprint
 * ============================================================
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const { createClient } = require('@supabase/supabase-js');

// -------------------------------------------------------
// ENVIRONMENT VALIDATION
// -------------------------------------------------------
const REQUIRED_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
REQUIRED_VARS.forEach((key) => {
  if (!process.env[key]) {
    console.error(`[SEB-LEDGER] FATAL: Missing environment variable: ${key}`);
    process.exit(1);
  }
});

const PORT         = parseInt(process.env.PORT, 10) || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// -------------------------------------------------------
// SUPABASE CLIENT
// -------------------------------------------------------
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// -------------------------------------------------------
// EXPRESS APP
// -------------------------------------------------------
const app = express();

// CORS — allow the Vite dev server (5173) and any localhost port
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (curl, Termux) or any localhost
    if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else {
      callback(null, true); // allow all for local dev
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------
function unwrap({ data, error }, context) {
  if (error) {
    const msg = `[SEB-LEDGER] Supabase error in "${context}": ${error.message}`;
    console.error(msg);
    throw Object.assign(new Error(error.message), { supabaseCode: error.code, context });
  }
  return data;
}

function computeCognitiveScore(transactions) {
  const total = transactions.length;
  if (total === 0) {
    return { score: 0, breakdown: { frequency: 0, volume: 0, consistency: 0, completion: 0 }, loan_limit: 0, model_version: 'SEB-AI-v1.0-MOCK' };
  }
  const frequencyScore = Math.min(30, Math.round((total / 30) * 30));
  const totalNetVolume = transactions.reduce((sum, t) => sum + parseFloat(t.net_amount || 0), 0);
  const volumeScore = Math.min(30, Math.round((totalNetVolume / 500000) * 30));
  const weeksWithActivity = new Set(
    transactions.map((t) => {
      const d = new Date(t.created_at);
      const startOfYear = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
      return `${d.getFullYear()}-W${weekNum}`;
    })
  ).size;
  const consistencyScore = Math.min(20, Math.round((weeksWithActivity / 4) * 20));
  const completed = transactions.filter((t) => t.status === 'COMPLETED').length;
  const completionScore = Math.round((completed / total) * 20);
  const score = Math.max(0, Math.min(100, frequencyScore + volumeScore + consistencyScore + completionScore));
  let loan_limit = Math.round(totalNetVolume * 3);
  if (score < 20) loan_limit = Math.min(loan_limit, 50000);
  else if (score < 40) loan_limit = Math.min(loan_limit, 200000);
  else if (score < 60) loan_limit = Math.min(loan_limit, 750000);
  else if (score < 80) loan_limit = Math.min(loan_limit, 3000000);
  else loan_limit = Math.min(loan_limit, 10000000);
  return {
    score,
    breakdown: { frequency: frequencyScore, volume: volumeScore, consistency: consistencyScore, completion: completionScore },
    loan_limit,
    total_net_volume_tzs: totalNetVolume,
    transactions_analysed: total,
    model_version: 'SEB-AI-v1.0-MOCK',
  };
}

// -------------------------------------------------------
// ROUTE: Health Check
// -------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    service: 'SEB-Ledger Core',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    founder: 'Alexander Eliud Letema — Letema Group',
  });
});

// -------------------------------------------------------
// ROUTE: GET /api/v1/merchants
// Supports: ?search=, ?region=, ?page=, ?page_size=
// -------------------------------------------------------
app.get('/api/v1/merchants', async (req, res) => {
  try {
    const search    = (req.query.search || '').trim();
    const region    = (req.query.region || '').trim();
    const page      = Math.max(1, parseInt(req.query.page, 10) || 1);
    const page_size = Math.min(100, Math.max(1, parseInt(req.query.page_size, 10) || 20));
    const from      = (page - 1) * page_size;
    const to        = from + page_size - 1;

    let query = supabase
      .from('merchants')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,phone_number.ilike.%${search}%`);
    }
    if (region) {
      query = query.eq('region', region);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const total_pages = Math.max(1, Math.ceil((count || 0) / page_size));

    return res.json({
      success: true,
      count: data.length,
      total: count || 0,
      page,
      page_size,
      total_pages,
      merchants: data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------
// ROUTE: POST /api/v1/merchants
// -------------------------------------------------------
app.post('/api/v1/merchants', async (req, res) => {
  const { full_name, nida_number, phone_number, business_type, region, district } = req.body;
  if (!full_name || !phone_number || !business_type || !region) {
    return res.status(400).json({ success: false, error: 'Required fields: full_name, phone_number, business_type, region' });
  }
  try {
    const data = unwrap(
      await supabase.from('merchants').insert([{ full_name, nida_number, phone_number, business_type, region, district }]).select().single(),
      'register-merchant'
    );
    return res.status(201).json({ success: true, message: 'Merchant registered successfully in the SEB-Ledger.', merchant: data });
  } catch (err) {
    if (err.supabaseCode === '23505') {
      return res.status(409).json({ success: false, error: 'A merchant with this phone number or NIDA already exists.' });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------
// ROUTE: POST /api/v1/webhooks/mobile-money
// -------------------------------------------------------
app.post('/api/v1/webhooks/mobile-money', async (req, res) => {
  const { phone_number, reference_id, gross_amount, currency = 'TZS', channel = 'MOBILE_MONEY' } = req.body;
  if (!phone_number || !reference_id || !gross_amount) {
    return res.status(400).json({ success: false, error: 'Required fields: phone_number, reference_id, gross_amount' });
  }
  const grossNum = parseFloat(gross_amount);
  if (isNaN(grossNum) || grossNum <= 0) {
    return res.status(400).json({ success: false, error: 'gross_amount must be a positive number.' });
  }
  try {
    const merchants = unwrap(
      await supabase.from('merchants').select('id, full_name, business_type, region, is_active').eq('phone_number', phone_number).limit(1),
      'webhook-merchant-lookup'
    );
    if (!merchants || merchants.length === 0) {
      return res.status(404).json({ success: false, error: `No merchant found for phone number: ${phone_number}.` });
    }
    const merchant = merchants[0];
    if (!merchant.is_active) {
      return res.status(403).json({ success: false, error: 'Merchant account is suspended.' });
    }
    const TAX_FLAT_TZS = 100;
    const tax_deducted = Math.min(TAX_FLAT_TZS, grossNum);
    const txRecord = unwrap(
      await supabase.from('transactions').insert([{
        merchant_id: merchant.id, reference_id: reference_id.toString().trim(),
        gross_amount: grossNum, tax_deducted, currency, channel, status: 'COMPLETED',
      }]).select().single(),
      'webhook-insert-transaction'
    );
    return res.status(201).json({
      success: true,
      message: 'Transaction processed and recorded in the SEB-Ledger.',
      ledger_entry: {
        transaction_id: txRecord.id, reference_id: txRecord.reference_id,
        merchant_id: merchant.id, merchant_name: merchant.full_name, merchant_region: merchant.region,
        gross_amount: txRecord.gross_amount, tax_deducted: txRecord.tax_deducted, net_amount: txRecord.net_amount,
        currency: txRecord.currency, channel: txRecord.channel, status: txRecord.status, recorded_at: txRecord.created_at,
      },
    });
  } catch (err) {
    if (err.supabaseCode === '23505') {
      return res.status(409).json({ success: false, error: `Duplicate transaction. Reference ID "${reference_id}" already processed.` });
    }
    return res.status(500).json({ success: false, error: 'Internal server error.', detail: err.message });
  }
});

// -------------------------------------------------------
// ROUTE: GET /api/v1/analytics/cognitive-score/:merchant_id
// -------------------------------------------------------
app.get('/api/v1/analytics/cognitive-score/:merchant_id', async (req, res) => {
  const { merchant_id } = req.params;
  try {
    const merchantData = unwrap(
      await supabase.from('merchants').select('id, full_name, business_type, region, district, phone_number').eq('id', merchant_id).single(),
      'score-merchant-lookup'
    );
    if (!merchantData) return res.status(404).json({ success: false, error: `Merchant not found: ${merchant_id}` });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const transactions = unwrap(
      await supabase.from('transactions').select('id, gross_amount, tax_deducted, net_amount, status, created_at')
        .eq('merchant_id', merchant_id).gte('created_at', thirtyDaysAgo.toISOString()).order('created_at', { ascending: false }),
      'score-fetch-transactions'
    );

    const scoreResult = computeCognitiveScore(transactions || []);
    const upsertPayload = { merchant_id, cognitive_score: scoreResult.score, loan_limit: scoreResult.loan_limit, computed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const scoreRecord = unwrap(
      await supabase.from('credit_scores').upsert(upsertPayload, { onConflict: 'merchant_id' }).select().single(),
      'score-upsert'
    );
    return res.json({
      success: true,
      message: 'Cognitive Credit Score computed and recorded.',
      report: {
        merchant: { id: merchantData.id, full_name: merchantData.full_name, business_type: merchantData.business_type, region: merchantData.region, district: merchantData.district, phone_number: merchantData.phone_number },
        score_card: { cognitive_score: scoreRecord.cognitive_score, score_tier: scoreRecord.score_tier, loan_limit_tzs: scoreRecord.loan_limit, last_computed: scoreRecord.computed_at },
        engine_details: { score_breakdown: scoreResult.breakdown, transactions_analysed: scoreResult.transactions_analysed, total_net_volume_tzs: scoreResult.total_net_volume_tzs, analysis_window_days: 30, model_version: scoreResult.model_version },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal server error.', detail: err.message });
  }
});

// -------------------------------------------------------
// ROUTE: GET /api/v1/analytics/timeseries
// Returns hourly/daily bucketed transaction totals for the chart.
// Supports: ?range=24h|7d|30d
// -------------------------------------------------------
app.get('/api/v1/analytics/timeseries', async (req, res) => {
  const range = req.query.range || '24h';
  const now = new Date();
  let since, bucketCount, bucketLabel;

  if (range === '24h') {
    since = new Date(now - 24 * 3600 * 1000);
    bucketCount = 24;
    bucketLabel = 'hour';
  } else if (range === '7d') {
    since = new Date(now - 7 * 86400 * 1000);
    bucketCount = 7;
    bucketLabel = 'day';
  } else {
    since = new Date(now - 30 * 86400 * 1000);
    bucketCount = 30;
    bucketLabel = 'day';
  }

  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('gross_amount, tax_deducted, net_amount, status, created_at')
      .gte('created_at', since.toISOString())
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Build buckets
    const buckets = [];
    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = new Date(since);
      if (bucketLabel === 'hour') {
        bucketStart.setHours(bucketStart.getHours() + i);
      } else {
        bucketStart.setDate(bucketStart.getDate() + i);
      }
      const bucketEnd = new Date(bucketStart);
      if (bucketLabel === 'hour') {
        bucketEnd.setHours(bucketEnd.getHours() + 1);
      } else {
        bucketEnd.setDate(bucketEnd.getDate() + 1);
      }

      const bucketTxns = (data || []).filter(t => {
        const d = new Date(t.created_at);
        return d >= bucketStart && d < bucketEnd;
      });

      buckets.push({
        t: bucketStart.toISOString(),
        inflow:  bucketTxns.reduce((s, t) => s + parseFloat(t.gross_amount || 0), 0),
        outflow: bucketTxns.reduce((s, t) => s + parseFloat(t.tax_deducted || 0), 0),
        net:     bucketTxns.reduce((s, t) => s + parseFloat(t.net_amount || 0), 0),
        count:   bucketTxns.length,
      });
    }

    return res.json({ success: true, range, bucket: bucketLabel, points: buckets });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------
// ROUTE: GET /api/v1/governance/dashboard
// -------------------------------------------------------
app.get('/api/v1/governance/dashboard', async (_req, res) => {
  try {
    const [txResult, merchantResult, scoreResult] = await Promise.all([
      supabase.from('transactions').select('gross_amount, tax_deducted, net_amount, status, channel, created_at'),
      supabase.from('merchants').select('id, region, business_type, is_active'),
      supabase.from('credit_scores').select('cognitive_score, loan_limit, score_tier'),
    ]);
    const transactions = unwrap(txResult, 'dashboard-transactions');
    const merchants    = unwrap(merchantResult, 'dashboard-merchants');
    const scores       = unwrap(scoreResult, 'dashboard-scores');

    const completedTxns = transactions.filter(t => t.status === 'COMPLETED');
    const totalGrossRevenue = completedTxns.reduce((s, t) => s + parseFloat(t.gross_amount), 0);
    const totalTaxCollected = completedTxns.reduce((s, t) => s + parseFloat(t.tax_deducted), 0);
    const totalNetVolume    = completedTxns.reduce((s, t) => s + parseFloat(t.net_amount || 0), 0);

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last24hTxns = completedTxns.filter(t => new Date(t.created_at) >= oneDayAgo);

    const regionBreakdown = merchants.reduce((acc, m) => {
      if (!acc[m.region]) acc[m.region] = { total: 0, active: 0 };
      acc[m.region].total++;
      if (m.is_active) acc[m.region].active++;
      return acc;
    }, {});

    const businessTypeBreakdown = merchants.reduce((acc, m) => {
      acc[m.business_type] = (acc[m.business_type] || 0) + 1;
      return acc;
    }, {});

    const channelBreakdown = completedTxns.reduce((acc, t) => {
      acc[t.channel] = (acc[t.channel] || 0) + 1;
      return acc;
    }, {});

    const tierDistribution = scores.reduce((acc, s) => {
      const tier = s.score_tier || 'UNRATED';
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    }, {});

    const totalLoanExposure = scores.reduce((s, sc) => s + parseFloat(sc.loan_limit || 0), 0);

    return res.json({
      success: true,
      generated_at: new Date().toISOString(),
      dashboard: {
        ledger_summary: {
          total_gross_revenue_tzs:  parseFloat(totalGrossRevenue.toFixed(2)),
          total_tax_collected_tzs:  parseFloat(totalTaxCollected.toFixed(2)),
          total_net_volume_tzs:     parseFloat(totalNetVolume.toFixed(2)),
          total_transactions:       transactions.length,
          completed_transactions:   completedTxns.length,
          failed_transactions:      transactions.filter(t => t.status === 'FAILED').length,
          last_24h_transactions:    last24hTxns.length,
          last_24h_gross_tzs:       parseFloat(last24hTxns.reduce((s, t) => s + parseFloat(t.gross_amount), 0).toFixed(2)),
        },
        merchant_stats: {
          total_registered:        merchants.length,
          active_merchants:        merchants.filter(m => m.is_active).length,
          inactive_merchants:      merchants.filter(m => !m.is_active).length,
          scored_merchants:        scores.length,
          regional_breakdown:      regionBreakdown,
          business_type_breakdown: businessTypeBreakdown,
        },
        credit_intelligence: {
          tier_distribution:       tierDistribution,
          total_loan_exposure_tzs: parseFloat(totalLoanExposure.toFixed(2)),
        },
        channel_analytics: channelBreakdown,
        system_info: {
          ledger_name:    'Pan-East African Informal Sector Economic Ledger',
          blueprint:      'Sovereign Ecosystem Blueprint (SEB)',
          founder:        'Alexander Eliud Letema — Letema Group',
          engine_version: '1.1.0',
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Internal server error.', detail: err.message });
  }
});

// -------------------------------------------------------
// 404 FALLBACK
// -------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`,
    available_routes: [
      'GET  /health',
      'GET  /api/v1/merchants',
      'POST /api/v1/merchants',
      'POST /api/v1/webhooks/mobile-money',
      'GET  /api/v1/analytics/cognitive-score/:merchant_id',
      'GET  /api/v1/analytics/timeseries?range=24h|7d|30d',
      'GET  /api/v1/governance/dashboard',
    ],
  });
});

// -------------------------------------------------------
// SERVER START
// -------------------------------------------------------
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     SEB-LEDGER CORE v1.1.0 — ENGINE ONLINE              ║');
  console.log('║     Pan-East African Informal Sector Economic Ledger     ║');
  console.log('║     Founder: Alexander Eliud Letema — Letema Group       ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Local:      http://localhost:${PORT}                        ║`);
  console.log(`║  Health:     http://localhost:${PORT}/health                 ║`);
  console.log(`║  Dashboard:  http://localhost:${PORT}/api/v1/governance/dashboard ║`);
  console.log(`║  Timeseries: http://localhost:${PORT}/api/v1/analytics/timeseries  ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`[SEB-LEDGER] Supabase: ${SUPABASE_URL}`);
  console.log('[SEB-LEDGER] All systems nominal. Awaiting transactions...');
});

module.exports = app;
