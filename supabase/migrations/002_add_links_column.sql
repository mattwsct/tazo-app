-- Add links column to creator_settings for admin-managed homepage links
ALTER TABLE public.creator_settings ADD COLUMN IF NOT EXISTS links jsonb;
