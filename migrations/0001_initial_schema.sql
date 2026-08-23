-- Initial schema. Shapes are normative in docs/architecture.md section 6.
-- `if not exists` is belt and braces: the schema_migrations ledger already
-- prevents re-application, but a hand-applied file should still be harmless.

create table if not exists api_keys (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  key_hash    bytea       not null unique,
  key_prefix  text        not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

comment on table api_keys is
  'Authenticates writes and admin reads. Retained indefinitely, including revoked keys, as audit evidence.';
comment on column api_keys.key_hash is 'SHA-256 of the raw key. The raw key is never stored.';
comment on column api_keys.key_prefix is 'First 8 characters of the raw key. Safe to log.';

create table if not exists urls (
  id               bigint      generated always as identity primary key,
  code             text        not null unique,
  destination_url  text        not null,
  created_by       uuid        not null references api_keys (id),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz,
  deleted_at       timestamptz,

  constraint urls_code_length check (char_length(code) = 7),
  constraint urls_destination_https check (destination_url like 'https://%'),
  constraint urls_expires_after_creation check (expires_at is null or expires_at > created_at)
);

comment on table urls is
  'The short code to destination mapping. Retained indefinitely; deletion is soft so click history stays meaningful.';

-- Supports expiry sweeps and reporting without scanning live rows.
create index if not exists urls_expires_at_idx
  on urls (expires_at)
  where expires_at is not null and deleted_at is null;

create table if not exists click_events (
  id          bigint      generated always as identity primary key,
  url_id      bigint      not null references urls (id),
  clicked_at  timestamptz not null default now(),
  ip_hash     bytea,
  user_agent  text,
  referrer    text
);

comment on table click_events is
  'One row per redirect served. Retained indefinitely in the prototype; production needs a retention policy.';
comment on column click_events.ip_hash is
  'SHA-256 of client IP plus a daily rotating salt. Raw IP addresses are never stored.';

-- Serves both the last-click lookup and the per-day group by behind /stats.
create index if not exists click_events_url_id_clicked_at_idx
  on click_events (url_id, clicked_at desc);

create table if not exists idempotency_keys (
  id                   bigint      generated always as identity primary key,
  api_key_id           uuid        not null references api_keys (id),
  idempotency_key      text        not null,
  request_fingerprint  bytea       not null,
  url_id               bigint      references urls (id),
  response_status      smallint    not null,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null default now() + interval '24 hours',

  -- Scoped per key so one client cannot collide with, or probe for, another's.
  constraint idempotency_keys_scope_unique unique (api_key_id, idempotency_key)
);

comment on table idempotency_keys is
  'Deduplication window making POST /api/v1/urls retryable. Retained 24 hours, then swept.';

create index if not exists idempotency_keys_expires_at_idx
  on idempotency_keys (expires_at);
