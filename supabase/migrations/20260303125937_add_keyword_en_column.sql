-- Add 'keyword_en' column to the 'keywords' table for translations

ALTER TABLE "public"."keywords" ADD COLUMN IF NOT EXISTS "keyword_en" text;

COMMENT ON COLUMN "public"."keywords"."keyword_en" IS 'English translation for the keyword';
