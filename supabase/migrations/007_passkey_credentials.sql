-- ============================================================
-- Migration 007: Passkey (WebAuthn) credentials for admin login
-- One row per registered passkey. Superadmin only.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.passkey_credentials (
  credential_id   text        PRIMARY KEY,           -- base64url-encoded credential ID
  public_key      text        NOT NULL,              -- base64url-encoded COSE public key
  counter         bigint      NOT NULL DEFAULT 0,    -- replay-attack counter
  device_type     text        NOT NULL DEFAULT 'singleDevice', -- singleDevice | multiDevice
  backed_up       boolean     NOT NULL DEFAULT false,
  transports      text[],                            -- ['internal','hybrid',...]
  name            text,                              -- human label e.g. "MacBook Touch ID"
  created_at      timestamptz DEFAULT now(),
  last_used_at    timestamptz
);

ALTER TABLE public.passkey_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_passkeys" ON public.passkey_credentials;
CREATE POLICY "service_role_all_passkeys" ON public.passkey_credentials FOR ALL USING (true);
