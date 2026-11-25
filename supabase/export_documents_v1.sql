-- Export module, step 2b: saved copies of the papers made from a shipment (one row per version, never edited).
create table if not exists public.exp_documents (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.exp_shipments(id) on delete cascade,
  kind text not null, title text not null, version int not null default 1,
  content jsonb not null, input_hash text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now());
create index if not exists exp_documents_ship on public.exp_documents (shipment_id, kind, version desc);
alter table public.exp_documents enable row level security;
create trigger exp_documents_stamp before insert or update on public.exp_documents for each row execute function public.exp_stamp();
create policy exp_documents_read on public.exp_documents for select using (public.hub_can_export());
create policy exp_documents_ins on public.exp_documents for insert with check (public.hub_can_export());
alter publication supabase_realtime add table public.exp_documents;
