-- ============================================
-- CallBoard - Supabase Database Setup
-- Run this SQL in the Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. PROFILES TABLE (extends auth.users)
-- ============================================
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  name text not null,
  role text not null default 'caller' check (role in ('manager', 'caller')),
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "Users can read all profiles" on public.profiles for select using (true);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), 'caller');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- 2. LEADS TABLE
-- ============================================
create table public.leads (
  id uuid default gen_random_uuid() primary key,
  company_name text not null,
  phone text not null,
  contact_name text default '',
  homepage text default '',
  next_activity_date date,
  status text not null default 'new' check (status in ('new','calling','contacted','appointment','excluded','dnc')),
  memo text default '',
  assigned_to uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.leads enable row level security;
create policy "Authenticated users can read all leads" on public.leads for select using (auth.role() = 'authenticated');
create policy "Authenticated users can insert leads" on public.leads for insert with check (auth.role() = 'authenticated');
create policy "Authenticated users can update leads" on public.leads for update using (auth.role() = 'authenticated');
create policy "Authenticated users can delete leads" on public.leads for delete using (auth.role() = 'authenticated');

-- ============================================
-- 3. CALL_LOGS TABLE
-- ============================================
create table public.call_logs (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references public.leads(id) on delete cascade not null,
  caller_id uuid references public.profiles(id) not null,
  called_at timestamptz default now(),
  result text not null check (result in ('no_answer','reception','connected','appointment','rejected','invalid')),
  memo text default '',
  created_at timestamptz default now()
);

alter table public.call_logs enable row level security;
create policy "Authenticated users can read all call_logs" on public.call_logs for select using (auth.role() = 'authenticated');
create policy "Authenticated users can insert call_logs" on public.call_logs for insert with check (auth.role() = 'authenticated');

-- ============================================
-- 4. TARGETS TABLE
-- ============================================
create table public.targets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) not null,
  period_type text not null check (period_type in ('daily','weekly','monthly')),
  period_start date not null,
  target_calls int default 0,
  target_connects int default 0,
  target_appointments int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, period_type, period_start)
);

alter table public.targets enable row level security;
create policy "Authenticated users can read all targets" on public.targets for select using (auth.role() = 'authenticated');
create policy "Users can manage own targets" on public.targets for insert with check (auth.uid() = user_id);
create policy "Users can update own targets" on public.targets for update using (auth.uid() = user_id);

-- ============================================
-- 5. HELPER: auto-update updated_at
-- ============================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger leads_updated_at
  before update on public.leads
  for each row execute function public.update_updated_at();

create trigger targets_updated_at
  before update on public.targets
  for each row execute function public.update_updated_at();
