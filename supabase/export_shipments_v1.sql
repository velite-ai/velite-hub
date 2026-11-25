-- Export module, step 2a: shipments and their product lines.
create table if not exists public.exp_shipments (
  id uuid primary key default gen_random_uuid(),
  firm_id text not null references public.exp_firms(id),
  country text not null,
  party_id uuid references public.exp_parties(id),          -- buyer / consignee
  notify_id uuid references public.exp_parties(id),
  brand_owner_id uuid references public.exp_parties(id),
  invoice_no text, invoice_date date,
  proforma_no text, proforma_date date,
  po_no text, po_date date,
  currency text not null default 'INR', exchange_rate numeric,   -- rupees per 1 unit of the invoice currency, typed by hand
  transport_mode text not null default 'road',
  port_loading text, port_discharge text, final_destination text, entry_point text,
  agent_id uuid references public.exp_agents(id), transporter_id uuid references public.exp_agents(id),
  eway_bill text, gr_no text,
  payment_terms text, delivery_terms text,
  status text not null default 'draft',
  notes text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now(), deleted_at timestamptz, deleted_by_name text);
create unique index if not exists exp_shipments_invoice_uq on public.exp_shipments (firm_id, lower(invoice_no)) where deleted_at is null and invoice_no is not null;
create index if not exists exp_shipments_date on public.exp_shipments (invoice_date desc);

create table if not exists public.exp_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.exp_shipments(id) on delete cascade,
  position int not null default 1,
  product_id uuid references public.exp_products(id),
  name text not null, hsn text,
  batch_id uuid references public.hub_batches(id) on delete set null, batch_no text, mfg date, exp date,
  qty int not null default 0, rate numeric,
  pcs_per_carton int, net_kg numeric, gross_kg numeric, partial_net numeric, partial_gross numeric,
  note text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now());
create index if not exists exp_lines_ship on public.exp_shipment_lines (shipment_id, position);

create or replace function public.exp_stamp() returns trigger language plpgsql security definer set search_path = public as $$
declare me text := public.hub_my_name();
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_by_name := coalesce(new.created_by_name, me); new.created_at := now(); end if;
  new.updated_at := now(); new.updated_by_name := me;
  if tg_table_name in ('exp_parties','exp_agents','exp_products','exp_shipments') then
    if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then new.deleted_by_name := me; end if;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['exp_shipments','exp_shipment_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.exp_stamp()', t||'_stamp', t);
    execute format('create policy %I on public.%I for select using (public.hub_can_export())', t||'_read', t);
    execute format('create policy %I on public.%I for insert with check (public.hub_can_export())', t||'_ins', t);
  end loop;
  execute 'create policy exp_shipments_upd on public.exp_shipments for update using (public.hub_can_export()) with check (public.hub_can_export() and (deleted_at is null or public.hub_is_owner()))';
  execute 'create policy exp_shipment_lines_upd on public.exp_shipment_lines for update using (public.hub_can_export()) with check (public.hub_can_export())';
  execute 'create policy exp_shipment_lines_del on public.exp_shipment_lines for delete using (public.hub_can_export())';
end $$;

alter publication supabase_realtime add table public.exp_shipments, public.exp_shipment_lines;
