-- ============================================================
-- Migration 005: Supabase as primary data store
-- Replaces KV (Upstash Redis) for credits, challenges, wallet,
-- and stream goals. KV is retained for ephemeral/real-time data
-- (blackjack, polls, trivia, alerts, SSE signals, OAuth tokens).
-- ============================================================

-- ==============================
-- viewer_balances: replaces KV credits hash
-- One row per viewer per creator. Updated atomically via RPC.
-- ==============================
CREATE TABLE IF NOT EXISTS public.viewer_balances (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_id  uuid        REFERENCES public.creators(id) ON DELETE CASCADE NOT NULL,
  platform    text        NOT NULL DEFAULT 'kick',
  platform_id text        NOT NULL, -- lowercase username (normalized)
  username    text        NOT NULL, -- display name (original casing)
  balance     bigint      NOT NULL DEFAULT 0,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (creator_id, platform, platform_id)
);
CREATE INDEX IF NOT EXISTS viewer_balances_leaderboard_idx
  ON public.viewer_balances (creator_id, platform, balance DESC)
  WHERE balance > 0;

ALTER TABLE public.viewer_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_viewer_balances" ON public.viewer_balances;
CREATE POLICY "service_role_all_viewer_balances" ON public.viewer_balances FOR ALL USING (true);

-- ==============================
-- challenges: replaces KV stream_challenges
-- ==============================
CREATE TABLE IF NOT EXISTS public.challenges (
  id             bigserial    PRIMARY KEY,
  creator_id     uuid         REFERENCES public.creators(id) ON DELETE CASCADE NOT NULL,
  seq            integer      NOT NULL,                  -- local ID shown in chat/admin
  description    text         NOT NULL,
  bounty         numeric(10,2) NOT NULL DEFAULT 0,
  status         text         NOT NULL DEFAULT 'active', -- active|completed|failed|timedOut
  created_at     timestamptz  DEFAULT now(),
  expires_at     timestamptz,
  resolved_at    timestamptz,
  buyer_username text,
  steps_target   integer,
  distance_target numeric(10,3),
  auto_deducted  boolean      DEFAULT false,             -- idempotency: replaces KV nx lock
  UNIQUE (creator_id, seq)
);
CREATE INDEX IF NOT EXISTS challenges_active_idx ON public.challenges (creator_id, status) WHERE status = 'active';

ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_challenges" ON public.challenges;
CREATE POLICY "service_role_all_challenges" ON public.challenges FOR ALL USING (true);

-- ==============================
-- creator_settings: add wallet, goals, challenge seq, and fix overlay column
-- The 'overlay' column stores the full overlay_settings JSON (was wrongly
-- saved as 'overlay' key but column was named 'settings' — now both exist).
-- ==============================
ALTER TABLE public.creator_settings
  ADD COLUMN IF NOT EXISTS overlay            jsonb,
  ADD COLUMN IF NOT EXISTS wallet_balance     numeric(10,2)  NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS wallet_updated_at  timestamptz    DEFAULT now(),
  ADD COLUMN IF NOT EXISTS wallet_last_change_usd    numeric(10,2),
  ADD COLUMN IF NOT EXISTS wallet_last_change_source text,
  ADD COLUMN IF NOT EXISTS wallet_local_currency     text,
  ADD COLUMN IF NOT EXISTS wallet_local_rate         numeric(15,6),
  ADD COLUMN IF NOT EXISTS goal_subs          integer        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goal_kicks         integer        NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goals_updated_at   timestamptz    DEFAULT now(),
  ADD COLUMN IF NOT EXISTS challenge_next_seq integer        NOT NULL DEFAULT 1;

-- ==============================
-- Postgres functions for atomic operations
-- ==============================

-- Atomic credit add (or first-time create). Returns new balance.
CREATE OR REPLACE FUNCTION public.increment_viewer_balance(
  p_creator_id  uuid,
  p_platform    text,
  p_platform_id text,
  p_username    text,
  p_delta       bigint
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE new_bal bigint;
BEGIN
  INSERT INTO public.viewer_balances (creator_id, platform, platform_id, username, balance, updated_at)
  VALUES (p_creator_id, p_platform, p_platform_id, p_username, GREATEST(0, p_delta), now())
  ON CONFLICT (creator_id, platform, platform_id) DO UPDATE
    SET balance    = GREATEST(0, viewer_balances.balance + p_delta),
        username   = EXCLUDED.username,
        updated_at = now()
  RETURNING balance INTO new_bal;
  RETURN COALESCE(new_bal, 0);
END; $$;

-- Atomic credit deduction with balance check. Returns (ok, new_balance).
CREATE OR REPLACE FUNCTION public.deduct_viewer_balance(
  p_creator_id  uuid,
  p_platform    text,
  p_platform_id text,
  p_amount      bigint
) RETURNS TABLE(ok boolean, new_balance bigint) LANGUAGE plpgsql AS $$
DECLARE cur_bal bigint; _new bigint;
BEGIN
  SELECT balance INTO cur_bal FROM public.viewer_balances
  WHERE creator_id = p_creator_id AND platform = p_platform AND platform_id = p_platform_id
  FOR UPDATE;

  IF cur_bal IS NULL OR cur_bal < p_amount THEN
    RETURN QUERY SELECT false, COALESCE(cur_bal, 0::bigint);
  ELSE
    UPDATE public.viewer_balances
    SET balance = balance - p_amount, updated_at = now()
    WHERE creator_id = p_creator_id AND platform = p_platform AND platform_id = p_platform_id
    RETURNING balance INTO _new;
    RETURN QUERY SELECT true, _new;
  END IF;
END; $$;

-- Atomic wallet balance update. Returns new balance.
CREATE OR REPLACE FUNCTION public.adjust_wallet_balance(
  p_creator_id uuid,
  p_delta      numeric,
  p_source     text,
  p_currency   text    DEFAULT NULL,
  p_rate       numeric DEFAULT NULL
) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE new_bal numeric;
BEGIN
  UPDATE public.creator_settings SET
    wallet_balance             = GREATEST(0, wallet_balance + p_delta),
    wallet_updated_at          = now(),
    wallet_last_change_usd     = p_delta,
    wallet_last_change_source  = p_source,
    wallet_local_currency      = COALESCE(p_currency, wallet_local_currency),
    wallet_local_rate          = COALESCE(p_rate, wallet_local_rate)
  WHERE creator_id = p_creator_id
  RETURNING wallet_balance INTO new_bal;
  RETURN COALESCE(new_bal, 0);
END; $$;

-- Atomic stream goal increment.
CREATE OR REPLACE FUNCTION public.increment_stream_goal(
  p_creator_id uuid,
  p_field      text,
  p_amount     integer
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_field = 'subs' THEN
    UPDATE public.creator_settings
    SET goal_subs = goal_subs + p_amount, goals_updated_at = now()
    WHERE creator_id = p_creator_id;
  ELSIF p_field = 'kicks' THEN
    UPDATE public.creator_settings
    SET goal_kicks = goal_kicks + p_amount, goals_updated_at = now()
    WHERE creator_id = p_creator_id;
  END IF;
END; $$;

-- Atomic next challenge seq (returns current value then increments).
CREATE OR REPLACE FUNCTION public.next_challenge_seq(
  p_creator_id uuid
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE seq_val integer;
BEGIN
  UPDATE public.creator_settings
  SET challenge_next_seq = challenge_next_seq + 1
  WHERE creator_id = p_creator_id
  RETURNING challenge_next_seq - 1 INTO seq_val;
  RETURN seq_val;
END; $$;
