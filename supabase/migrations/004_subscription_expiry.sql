-- Track when each viewer's subscription expires (for Discord role removal on lapse)
ALTER TABLE public.viewer_profiles
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_subscriber boolean NOT NULL DEFAULT false;

-- Index for efficient lapse detection queries
CREATE INDEX IF NOT EXISTS viewer_profiles_sub_expiry_idx
  ON public.viewer_profiles (subscription_expires_at)
  WHERE is_subscriber = true;
