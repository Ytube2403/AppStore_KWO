-- Migration: Add store column to datasets table
-- Identifies which app store this dataset targets (Apple App Store or Google Play)

ALTER TABLE public.datasets
    ADD COLUMN IF NOT EXISTS store TEXT NOT NULL DEFAULT 'apple'
    CHECK (store IN ('apple', 'google_play'));

COMMENT ON COLUMN public.datasets.store IS
    'Target app store: ''apple'' = Apple App Store, ''google_play'' = Google Play';
