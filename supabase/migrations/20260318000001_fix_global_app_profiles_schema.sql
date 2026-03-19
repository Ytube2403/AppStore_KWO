-- ============================================================
-- Fix global_app_profiles schema
-- Date: 2026-03-18
--
-- The Sprint 1 migration created global_app_profiles with a single
-- `app_url TEXT UNIQUE` column, but generate-profile/route.ts queries
-- by (app_store_id, store, country) with a composite unique constraint.
-- This migration aligns the schema with the route.
-- ============================================================

-- Add missing columns (safe with IF NOT EXISTS / DEFAULT)
ALTER TABLE public.global_app_profiles
    ADD COLUMN IF NOT EXISTS app_store_id    TEXT,
    ADD COLUMN IF NOT EXISTS store           TEXT CHECK (store IN ('apple', 'google_play')),
    ADD COLUMN IF NOT EXISTS country         TEXT DEFAULT 'us',
    ADD COLUMN IF NOT EXISTS title           TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS category        TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS semantic_profile JSONB,
    ADD COLUMN IF NOT EXISTS last_analyzed_at TIMESTAMPTZ;

-- Backfill app_store_id from app_url for existing rows (best effort)
UPDATE public.global_app_profiles
SET
    app_store_id = CASE
        WHEN app_url LIKE '%apps.apple.com%' THEN
            -- Extract numeric ID after /id
            substring(app_url FROM '/id(\d+)')
        WHEN app_url LIKE '%play.google.com%' THEN
            -- Extract package name after id=
            substring(app_url FROM '[?&]id=([^&\s]+)')
        ELSE NULL
    END,
    store = CASE
        WHEN app_url LIKE '%apps.apple.com%' THEN 'apple'
        WHEN app_url LIKE '%play.google.com%' THEN 'google_play'
        ELSE NULL
    END
WHERE app_store_id IS NULL;

-- Add composite unique constraint (used by upsert in generate-profile route)
-- Drop old unique constraint on app_url first to avoid conflicts
ALTER TABLE public.global_app_profiles
    DROP CONSTRAINT IF EXISTS global_app_profiles_app_url_key;

-- Add new composite unique constraint
ALTER TABLE public.global_app_profiles
    DROP CONSTRAINT IF EXISTS global_app_profiles_app_store_id_store_country_key;

ALTER TABLE public.global_app_profiles
    ADD CONSTRAINT global_app_profiles_app_store_id_store_country_key
    UNIQUE (app_store_id, store, country);

-- Add index for the composite lookup
CREATE INDEX IF NOT EXISTS idx_global_app_profiles_lookup
    ON public.global_app_profiles(app_store_id, store, country);
