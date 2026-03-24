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
  email text default '',
  homepage text default '',
  lead_source text default '',
  inquiry_date date,
  inquiry_content text default '',
  next_activity_date date,
  status text not null default 'new' check (status in ('new','unreviewed','calling','contacted','appointment','excluded','dnc','duplicate')),
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
create policy "Authenticated users can update call_logs" on public.call_logs for update using (auth.role() = 'authenticated');
create policy "Authenticated users can delete call_logs" on public.call_logs for delete using (auth.role() = 'authenticated');

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
-- 5. EMAIL_TEMPLATES TABLE
-- ============================================
create table public.email_templates (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  subject text not null default '',
  body text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.email_templates enable row level security;
create policy "Authenticated users can read all email_templates" on public.email_templates for select using (auth.role() = 'authenticated');
create policy "Authenticated users can insert email_templates" on public.email_templates for insert with check (auth.role() = 'authenticated');
create policy "Authenticated users can update email_templates" on public.email_templates for update using (auth.role() = 'authenticated');
create policy "Authenticated users can delete email_templates" on public.email_templates for delete using (auth.role() = 'authenticated');

-- Default templates
insert into public.email_templates (name, subject, body) values
  ('初回ご挨拶', 'お問い合わせありがとうございます', '{contact_name} 様

お世話になっております。
この度はお問い合わせいただき、誠にありがとうございます。

ご質問いただいた内容について、ご案内させていただきたくご連絡いたしました。
お手すきの際にお電話またはメールにてご都合の良い日時をお知らせいただけますと幸いです。

何卒よろしくお願いいたします。'),
  ('アポイント依頼', '【ご面談のお願い】{company_name} 様', '{contact_name} 様

お世話になっております。
先日はお電話にてお話しいただき、ありがとうございました。

つきましては、改めてお打ち合わせのお時間をいただけないかと思いご連絡いたしました。
下記の日程でご都合のよい日時がございましたら、ご返信いただけますと幸いです。

・
・
・

何卒よろしくお願いいたします。'),
  ('フォローアップ', '先日のご連絡の件', '{contact_name} 様

お世話になっております。
先日ご連絡させていただいた件について、その後ご検討状況はいかがでしょうか。

ご不明な点やご質問がございましたら、お気軽にお問い合わせください。

引き続きよろしくお願いいたします。');

-- ============================================
-- 5b. ADD COLUMNS FOR AI EMAIL GENERATION
-- Run this if leads table already exists
-- ============================================
alter table public.leads add column if not exists industry text default '';
alter table public.leads add column if not exists company_size text default '';
alter table public.leads add column if not exists overseas_interest text default '';
alter table public.leads add column if not exists target_countries text default '';

-- ============================================
-- 5c. ADD ACTIVITY TYPE TO CALL_LOGS
-- Run this if call_logs table already exists
-- ============================================
alter table public.call_logs add column if not exists activity_type text default 'call' check (activity_type in ('call', 'email'));
-- Allow 'email_sent' as a result for email activities
alter table public.call_logs drop constraint if exists call_logs_result_check;
alter table public.call_logs add constraint call_logs_result_check check (result in ('no_answer','reception','connected','appointment','rejected','invalid','email_sent'));

-- ============================================
-- 6. HELPER: auto-update updated_at
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

create trigger email_templates_updated_at
  before update on public.email_templates
  for each row execute function public.update_updated_at();
