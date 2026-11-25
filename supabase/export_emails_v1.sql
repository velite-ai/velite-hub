-- Export: log of the emails the Hub sends (proforma to the party). Written only by the export-send-mail function.
create table if not exists public.exp_emails (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references public.exp_shipments(id) on delete set null,
  kind text not null default 'proforma',
  sender text not null, from_addr text not null, reply_to text,
  to_addrs text[] not null default '{}', cc_addrs text[] not null default '{}',
  subject text not null, body text not null,
  attachment_id uuid references public.exp_attachments(id) on delete set null, attachment_name text,
  status text not null default 'sent', error text, provider_id text,
  sent_by uuid, sent_by_name text, sent_at timestamptz not null default now());
create index if not exists exp_emails_ship on public.exp_emails (shipment_id, sent_at desc);
create index if not exists exp_emails_sent on public.exp_emails (sent_at desc);
alter table public.exp_emails enable row level security;
create policy exp_emails_read on public.exp_emails for select using (public.hub_can_export());
alter publication supabase_realtime add table public.exp_emails;
