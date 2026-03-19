-- ============================================================
-- Migration: Sync store ← platform, add country_code alias
-- Date: 2026-03-18
-- Context:
--   The original datasets table had 'platform' and 'market' columns.
--   A later migration added 'store' (NOT NULL DEFAULT 'apple', CHECK IN ('apple','google_play'))
--   and workers read from 'store' and 'country_code'.
--   This migration syncs the data so workers get correct values.
-- ============================================================

-- 1. Sync store ← platform for rows that haven't been explicitly set
--    (safe: only overwrites the 'apple' default when platform has a valid value)
UPDATE public.datasets
SET store = CASE
    WHEN LOWER(platform) IN ('google_play', 'android', 'googleplay') THEN 'google_play'
    WHEN LOWER(platform) IN ('apple', 'ios', 'appstore', 'app_store') THEN 'apple'
    ELSE 'google_play'  -- default to google_play since Apple is disabled
END
WHERE store = 'apple';  -- only rows still at the DEFAULT (never explicitly set)

-- 2. Add country_code column as alias for market (if not already added)
ALTER TABLE public.datasets
    ADD COLUMN IF NOT EXISTS country_code TEXT;

-- 3. Sync country_code ← market  
UPDATE public.datasets
SET country_code = CASE
    WHEN market IS NULL OR market = '' THEN 'us'
    WHEN LENGTH(market) = 2 THEN LOWER(market)
    -- Handle full country names
    WHEN LOWER(market) IN ('japan', 'japanese') THEN 'jp'
    WHEN LOWER(market) IN ('germany', 'german', 'deutsch') THEN 'de'
    WHEN LOWER(market) IN ('france', 'french') THEN 'fr'
    WHEN LOWER(market) IN ('vietnam', 'vietnamese') THEN 'vn'
    WHEN LOWER(market) IN ('thailand', 'thai') THEN 'th'
    WHEN LOWER(market) IN ('korea', 'korean') THEN 'kr'
    WHEN LOWER(market) IN ('china', 'chinese') THEN 'cn'
    WHEN LOWER(market) IN ('taiwan') THEN 'tw'
    ELSE LOWER(LEFT(market, 2))
END
WHERE country_code IS NULL;

-- Result check
SELECT id, name, platform, store, market, country_code
FROM public.datasets
ORDER BY created_at DESC;
