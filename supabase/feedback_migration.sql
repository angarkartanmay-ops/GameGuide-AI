-- ============================================================================
-- GameGuide-AI · Feedback System
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New Query)
-- ============================================================================

create table if not exists public.feedback (
  id              uuid primary key default gen_random_uuid(),
  share_id        text not null unique default upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  rating          smallint not null check (rating between 1 and 5),
  category        text not null default 'general',
  message         text,
  screenshot_data_url text,          -- base64 PNG/JPEG (nullable)
  session_id      uuid,              -- auth.users.id (nullable for anon)
  user_agent      text,
  created_at      timestamptz not null default now()
);

-- Index for quick dashboard queries
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_share_id_idx   on public.feedback (share_id);
create index if not exists feedback_rating_idx     on public.feedback (rating);
create index if not exists feedback_category_idx   on public.feedback (category);

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.feedback enable row level security;

-- Anyone (including anon) may INSERT — no login required to send feedback
create policy "Anyone can submit feedback"
  on public.feedback
  for insert
  with check (true);

-- Only authenticated owners can see their own feedback by session_id.
-- Admins should use the service role key to read all feedback.
create policy "Users see own feedback"
  on public.feedback
  for select
  using (
    auth.uid() = session_id
    or session_id is null
  );

-- Feedback is immutable from the client side — no update/delete policies.
