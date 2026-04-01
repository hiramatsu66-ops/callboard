-- Email Queue table for outreach management
create table if not exists public.email_queue (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references public.leads(id) on delete cascade not null,
  subject text not null default '',
  body text not null default '',
  template_type text not null default 'reapproach',
  status text not null default 'pending' check (status in ('pending', 'approved', 'sent', 'skipped', 'failed')),
  created_at timestamptz default now(),
  sent_at timestamptz,
  error_message text
);

alter table public.email_queue enable row level security;
create policy "Authenticated users can read email_queue" on public.email_queue for select using (auth.role() = 'authenticated');
create policy "Authenticated users can insert email_queue" on public.email_queue for insert with check (auth.role() = 'authenticated');
create policy "Authenticated users can update email_queue" on public.email_queue for update using (auth.role() = 'authenticated');
create policy "Authenticated users can delete email_queue" on public.email_queue for delete using (auth.role() = 'authenticated');

-- Index for fast lookups
create index if not exists idx_email_queue_status on public.email_queue(status);
create index if not exists idx_email_queue_lead_id on public.email_queue(lead_id);
