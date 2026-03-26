create table if not exists public.import_batches (
  id uuid default gen_random_uuid() primary key,
  source_type text not null check (source_type in ('csv', 'manual', 'hubspot', 'natural_language', 'api')),
  source_detail text default '',
  record_count int default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

alter table public.import_batches enable row level security;
create policy "Authenticated users can read all import_batches" on public.import_batches for select using (auth.role() = 'authenticated');
create policy "Authenticated users can insert import_batches" on public.import_batches for insert with check (auth.role() = 'authenticated');

create table if not exists public.audit_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id),
  action text not null check (action in ('create', 'update', 'delete', 'bulk_update', 'bulk_delete', 'import', 'email_sent')),
  target_type text not null,
  target_id text,
  changes jsonb default '{}',
  created_at timestamptz default now()
);

alter table public.audit_logs enable row level security;
create policy "Authenticated users can read all audit_logs" on public.audit_logs for select using (auth.role() = 'authenticated');
create policy "Authenticated users can insert audit_logs" on public.audit_logs for insert with check (auth.role() = 'authenticated');

create index if not exists idx_audit_logs_target on public.audit_logs (target_type, target_id);
create index if not exists idx_audit_logs_user on public.audit_logs (user_id, created_at desc);

alter table public.leads add column if not exists import_batch_id uuid references public.import_batches(id);
alter table public.leads add column if not exists created_by uuid references public.profiles(id);
