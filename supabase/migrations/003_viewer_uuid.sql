-- Add viewer_uuid to viewer_profiles for cross-platform account linking
ALTER TABLE public.viewer_profiles ADD COLUMN IF NOT EXISTS viewer_uuid uuid;
CREATE INDEX IF NOT EXISTS viewer_profiles_viewer_uuid_idx ON public.viewer_profiles (viewer_uuid);
