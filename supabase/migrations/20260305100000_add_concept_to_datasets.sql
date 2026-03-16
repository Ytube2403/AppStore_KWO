-- Migration: Add Concept column to datasets table
ALTER TABLE public.datasets ADD COLUMN IF NOT EXISTS concept TEXT;
