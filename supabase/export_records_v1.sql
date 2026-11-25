-- Export module, step 2c: outside documents kept with a shipment (files in a private bucket) and the facts typed from them, for the audit.
insert into storage.buckets (id, name, public, file_size_limit) values ('export', 'export', false, 26214400) on conflict (id) do nothing;
create policy exp_files_read on storage.objects for select using (bucket_id = 'export' and public.hub_can_export());
create policy exp_files_write on storage.objects for insert with check (bucket_id = 'export' and public.hub_can_export());
create policy exp_files_delete on storage.objects for delete using (bucket_id = 'export' and public.hub_can_export());

create table if not exists public.exp_attachments (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.exp_shipments(id) on delete cascade,
  kind text not null, title text, ref_no text, doc_date date, facts jsonb not null default '{}',
  file_path text, file_name text, notes text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now());
create index if not exists exp_attachments_ship on public.exp_attachments (shipment_id);
alter table public.exp_attachments enable row level security;
create trigger exp_attachments_stamp before insert or update on public.exp_attachments for each row execute function public.exp_stamp();
create policy exp_attachments_read on public.exp_attachments for select using (public.hub_can_export());
create policy exp_attachments_ins on public.exp_attachments for insert with check (public.hub_can_export());
create policy exp_attachments_upd on public.exp_attachments for update using (public.hub_can_export()) with check (public.hub_can_export());
create policy exp_attachments_del on public.exp_attachments for delete using (public.hub_can_export());
alter publication supabase_realtime add table public.exp_attachments;
