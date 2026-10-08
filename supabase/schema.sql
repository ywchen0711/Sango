-- 三國志 自動戰鬥：存檔資料表
-- 在 Supabase 後台 SQL Editor 貼上整段執行一次即可

create table if not exists public.saves (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 開啟 Row Level Security：每個人只能讀寫自己的那一列
alter table public.saves enable row level security;

drop policy if exists "read own save" on public.saves;
drop policy if exists "insert own save" on public.saves;
drop policy if exists "update own save" on public.saves;

create policy "read own save" on public.saves
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own save" on public.saves
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own save" on public.saves
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Data API 存取權限（未登入的 anon 角色完全不給）
revoke all on public.saves from anon;
grant select, insert, update on public.saves to authenticated;
