-- Export module: settlement of export proceeds (payment received against each export invoice, e-BRC and bank EDPMS closure).
alter table public.exp_shipments
  add column if not exists due_months integer check (due_months is null or due_months between 1 and 36),
  add column if not exists write_off numeric(14,2) not null default 0 check (write_off >= 0),
  add column if not exists brc_no text,
  add column if not exists brc_date date,
  add column if not exists edpms_closed boolean not null default false,
  add column if not exists settle_notes text;

create table if not exists public.exp_receipts (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.exp_shipments(id) on delete cascade,
  received_on date not null,
  amount numeric(14,2) not null check (amount > 0),
  bank_ref text, notes text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now());
create index if not exists exp_receipts_ship on public.exp_receipts (shipment_id);
alter table public.exp_receipts enable row level security;
create trigger exp_receipts_stamp before insert or update on public.exp_receipts for each row execute function public.exp_stamp();
create policy exp_receipts_read on public.exp_receipts for select using (public.hub_can_export());
create policy exp_receipts_ins on public.exp_receipts for insert with check (public.hub_can_export());
create policy exp_receipts_upd on public.exp_receipts for update using (public.hub_can_export()) with check (public.hub_can_export());
create policy exp_receipts_del on public.exp_receipts for delete using (public.hub_can_export());
alter publication supabase_realtime add table public.exp_receipts;
