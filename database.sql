-- ============================================================
--  SEB-LEDGER CORE — Database Schema (DDL)
--  The Pan-East African Informal Sector Economic Ledger
--  Intellectual Property: Alexander Eliud Letema, Letema Group
--
--  Run this in your Supabase SQL Editor to initialise the schema.
-- ============================================================

-- Enable the UUID extension (enabled by default on Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -------------------------------------------------------
-- TABLE: merchants
-- Stores registered informal sector merchants across
-- Pan-East African regions.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchants (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name         TEXT NOT NULL,
    nida_number       TEXT UNIQUE,           -- Tanzania NIDA / EA national ID
    phone_number      TEXT UNIQUE NOT NULL,  -- Primary mobile money identifier (e.g. 0712345678)
    business_type     TEXT NOT NULL,         -- e.g. 'Retail', 'Food Vendor', 'Bodaboda', 'Salon'
    region            TEXT NOT NULL,         -- e.g. 'Dar es Salaam', 'Arusha', 'Mwanza'
    district          TEXT,                  -- e.g. 'Kinondoni', 'Ilala', 'Temeke'
    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- TABLE: transactions
-- Records every mobile-money transaction event processed
-- through the SEB-Ledger webhook engine.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id       UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    reference_id      TEXT UNIQUE NOT NULL,  -- External transaction hash from mobile money provider
    gross_amount      NUMERIC(15, 2) NOT NULL CHECK (gross_amount > 0),
    tax_deducted      NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (tax_deducted >= 0),
    net_amount        NUMERIC(15, 2) GENERATED ALWAYS AS (gross_amount - tax_deducted) STORED,
    currency          TEXT NOT NULL DEFAULT 'TZS',
    status            TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED')),
    channel           TEXT DEFAULT 'MOBILE_MONEY', -- e.g. 'MPESA', 'TIGOPESA', 'AIRTEL_MONEY', 'AZAMPAY'
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- TABLE: credit_scores
-- Stores the computed Cognitive Credit Score for each
-- merchant, updated by the AI Engine endpoint.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_scores (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id       UUID UNIQUE NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    cognitive_score   NUMERIC(5, 2) NOT NULL DEFAULT 0
                        CHECK (cognitive_score >= 0 AND cognitive_score <= 100),
    loan_limit        NUMERIC(15, 2) NOT NULL DEFAULT 0,  -- Calculated maximum loan in TZS
    score_tier        TEXT GENERATED ALWAYS AS (
                        CASE
                          WHEN cognitive_score >= 80 THEN 'SOVEREIGN'
                          WHEN cognitive_score >= 60 THEN 'ESTABLISHED'
                          WHEN cognitive_score >= 40 THEN 'GROWING'
                          WHEN cognitive_score >= 20 THEN 'EMERGING'
                          ELSE 'UNRATED'
                        END
                      ) STORED,
    computed_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------
-- INDEXES — for query performance at scale
-- -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_merchants_phone       ON merchants(phone_number);
CREATE INDEX IF NOT EXISTS idx_merchants_region      ON merchants(region);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created  ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_status   ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_credit_scores_merchant ON credit_scores(merchant_id);

-- -------------------------------------------------------
-- FUNCTION: auto-update updated_at timestamps
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_merchants_updated_at
    BEFORE UPDATE ON merchants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_credit_scores_updated_at
    BEFORE UPDATE ON credit_scores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -------------------------------------------------------
-- SEED DATA — Sample merchants for local simulation
-- -------------------------------------------------------
INSERT INTO merchants (full_name, nida_number, phone_number, business_type, region, district)
VALUES
    ('Amina Salim Juma',   '19901205-00001-00001-1', '0712000001', 'Food Vendor',   'Dar es Salaam', 'Kinondoni'),
    ('Hassan Omari Nkuki', '19880315-00002-00002-2', '0754000002', 'Retail',        'Arusha',        'Arusha Urban'),
    ('Grace Zawadi Mwita', '19951120-00003-00003-3', '0768000003', 'Salon',         'Mwanza',        'Nyamagana'),
    ('Juma Bakari Ally',   '19820601-00004-00004-4', '0622000004', 'Bodaboda',      'Dodoma',        'Dodoma Urban'),
    ('Fatuma Ali Hassan',  '20000809-00005-00005-5', '0655000005', 'Mobile Vendor', 'Dar es Salaam', 'Ilala')
ON CONFLICT (phone_number) DO NOTHING;
