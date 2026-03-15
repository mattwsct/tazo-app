-- ============================================================
-- Migration 006: Creator API keys
-- Stores per-creator third-party API keys in creator_settings.
-- Keys are read server-side only. The overlay will eventually
-- fetch them via get-settings instead of NEXT_PUBLIC_ env vars,
-- enabling multi-creator support without per-creator deployments.
-- ============================================================

ALTER TABLE public.creator_settings
  ADD COLUMN IF NOT EXISTS api_keys jsonb;

COMMENT ON COLUMN public.creator_settings.api_keys IS
  'Per-creator third-party API keys. Shape: { rtirl_pull_key, pulsoid_token, locationiq_key, openweather_key }';
