-- ============================================================
-- Tazo Platform — Initial Schema
-- Run this in the Supabase SQL editor (Project → SQL Editor → New query)
-- ============================================================

-- Users: extends Supabase auth.users
create table if not exists public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz default now()
);
comment on table public.users is 'Extended profile for authenticated users (creators and future viewer accounts)';

-- Creators: a user who has a stream setup
create table if not exists public.creators (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users(id) on delete set null,
  slug            text not null unique,           -- e.g. "tazo" — used in all URLs
  kick_channel    text,
  twitch_channel  text,
  created_at      timestamptz default now()
);
comment on table public.creators is 'A creator account (streamer). One row per streamer.';

-- Seed Tazo as the first creator (no user_id yet — linked when auth is set up)
insert into public.creators (slug, kick_channel, twitch_channel)
values ('tazo', 'tazo', 'tazo')
on conflict (slug) do nothing;

-- Creator members: mods and trusted viewers associated with a creator
create table if not exists public.creator_members (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references public.creators(id) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  role        text not null default 'viewer',     -- 'owner' | 'mod' | 'viewer'
  platform    text,                               -- 'kick' | 'discord'
  platform_id text,
  created_at  timestamptz default now(),
  unique (creator_id, platform, platform_id)
);

-- Viewer profiles: platform identity for chat users (no login required)
create table if not exists public.viewer_profiles (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references public.creators(id) on delete cascade,
  platform    text not null,                      -- 'kick' | 'twitch'
  platform_id text not null,
  username    text,
  created_at  timestamptz default now(),
  unique (creator_id, platform, platform_id)
);
comment on table public.viewer_profiles is 'Platform identity for chatters — no login required. Used as FK in point_ledger.';

-- Linked identities: OAuth tokens per creator (bot auth)
create table if not exists public.linked_identities (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references public.creators(id) on delete cascade,
  provider      text not null,                    -- 'kick' | 'discord'
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  scope         text,
  raw           jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (creator_id, provider)
);
comment on table public.linked_identities is 'OAuth tokens for creator bot integrations (Kick, Discord).';

-- Creator settings: overlay config, message templates, feature flags
create table if not exists public.creator_settings (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references public.creators(id) on delete cascade unique,
  overlay       jsonb not null default '{}',      -- OverlaySettings struct
  kick_messages jsonb not null default '{}',      -- KickMessageTemplates
  poll_config   jsonb not null default '{}',      -- PollSettings
  alert_config  jsonb not null default '{}',      -- KickAlertSettings
  updated_at    timestamptz default now()
);
comment on table public.creator_settings is 'All persistent settings per creator. overlay column replaces Upstash overlay_settings key.';

-- Point ledger: immutable credit/chip transactions
create table if not exists public.point_ledger (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references public.creators(id) on delete cascade,
  viewer_id   uuid references public.viewer_profiles(id) on delete set null,
  platform_id text,                               -- denormalized for fast lookup without join
  username    text,                               -- denormalized display name at time of event
  delta       integer not null,                   -- positive = earn, negative = spend
  reason      text,                               -- 'sub' | 'gift_sub' | 'kicks' | 'command' | 'admin' | 'blackjack'
  meta        jsonb,                              -- extra context (e.g. opponent, amount)
  created_at  timestamptz default now()
);
comment on table public.point_ledger is 'Immutable ledger of all credit/chip transactions. Balance = sum of delta per viewer.';

create index if not exists point_ledger_creator_platform_idx on public.point_ledger (creator_id, platform_id);

-- Challenge events
create table if not exists public.challenge_events (
  id                  uuid primary key default gen_random_uuid(),
  creator_id          uuid not null references public.creators(id) on delete cascade,
  description         text not null,
  bounty_usd          numeric(10,2),
  status              text not null default 'open',  -- 'open' | 'active' | 'completed' | 'expired'
  buyer_name          text,
  target_steps        integer,
  target_distance_km  numeric,
  expires_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz default now()
);
comment on table public.challenge_events is 'Viewer-purchased challenges (replaces Upstash overlay_challenges key).';

-- Gift events: gifted subs, Kicks gifted, etc. from webhooks
create table if not exists public.gift_events (
  id             uuid primary key default gen_random_uuid(),
  creator_id     uuid not null references public.creators(id) on delete cascade,
  event_type     text not null,                    -- 'kicks_gifted' | 'gift_sub_single' | 'gift_sub_multi'
  gifter_name    text,
  recipient_name text,
  quantity       integer default 1,
  platform       text not null default 'kick',
  raw            jsonb,                            -- full webhook payload for debugging
  received_at    timestamptz default now()
);
comment on table public.gift_events is 'Log of gifting events received via Kick webhooks.';

-- Admin actions: audit log
create table if not exists public.admin_actions (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid references public.creators(id) on delete set null,
  actor       text not null,                      -- username or 'system'
  action      text not null,                      -- e.g. 'reset_leaderboard', 'add_credits'
  target      text,                               -- affected entity (username, challenge id, etc.)
  meta        jsonb,
  created_at  timestamptz default now()
);
comment on table public.admin_actions is 'Audit log for admin and system actions.';

-- ============================================================
-- Row Level Security
-- v1 strategy: enable RLS on all tables, but use service role
-- from the app (which bypasses RLS). Policies are stubs for now.
-- ============================================================

alter table public.users enable row level security;
alter table public.creators enable row level security;
alter table public.creator_members enable row level security;
alter table public.viewer_profiles enable row level security;
alter table public.linked_identities enable row level security;
alter table public.creator_settings enable row level security;
alter table public.point_ledger enable row level security;
alter table public.challenge_events enable row level security;
alter table public.gift_events enable row level security;
alter table public.admin_actions enable row level security;

-- Public read access for viewer-facing tables
create policy "public_read_viewer_profiles"
  on public.viewer_profiles for select using (true);

create policy "public_read_point_ledger"
  on public.point_ledger for select using (true);

create policy "public_read_challenge_events"
  on public.challenge_events for select using (true);

create policy "public_read_creators"
  on public.creators for select using (true);

-- All other access goes through the service role key (bypasses RLS)
-- Additional policies will be added in future migrations when viewer auth is live
