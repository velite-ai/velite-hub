-- Export module, step 1: access, masters (firms, parties, agents, products, prices, country rule sets) and a log of data-sheet uploads.
alter table public.hub_profiles add column if not exists export_access boolean not null default false;

create or replace function public.hub_can_export() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hub_profiles where id = auth.uid() and status = 'approved' and (role = 'owner' or export_access)) $$;

create or replace function public.hub_admin_set_export(p_user uuid, p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.hub_is_owner() then raise exception 'Owners only'; end if;
  update public.hub_profiles set export_access = p_on where id = p_user;
end $$;

create or replace function public.exp_stamp() returns trigger language plpgsql security definer set search_path = public as $$
declare me text := public.hub_my_name();
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_by_name := coalesce(new.created_by_name, me); new.created_at := now(); end if;
  new.updated_at := now(); new.updated_by_name := me;
  if tg_table_name in ('exp_parties','exp_agents','exp_products') then
    if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then new.deleted_by_name := me; end if;
  end if;
  return new;
end $$;

create table if not exists public.exp_firms (
  id text primary key, name text not null, address text, phone text, email text, iec text, gstin text, pan text, dl_no text,
  signatory_name text, signatory_title text, bank jsonb not null default '{}', lut jsonb not null default '{}', notes text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now());

create table if not exists public.exp_parties (
  id uuid primary key default gen_random_uuid(), name text not null, country text not null, roles text[] not null default '{buyer,consignee}',
  address text, contact_person text, phone text, email text, ids jsonb not null default '{}', currency text not null default 'INR',
  usual_firm text, payment_terms text, delivery_terms text, entry_point text, notes text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now(), deleted_at timestamptz, deleted_by_name text);

create table if not exists public.exp_agents (
  id uuid primary key default gen_random_uuid(), name text not null, kind text not null default 'transporter', city text, phone text, email text, notes text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now(), deleted_at timestamptz, deleted_by_name text);

create table if not exists public.exp_products (
  id uuid primary key default gen_random_uuid(), firm_id text not null references public.exp_firms(id), name text not null, hsn text,
  pcs_per_carton int, net_kg numeric, gross_kg numeric, carton_size text, shelf_life_months int, brand_owner text,
  reg_product_id uuid references public.reg_products(id) on delete set null, source text not null default 'manual', check_note text, last_seen date, notes text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now(), deleted_at timestamptz, deleted_by_name text);
create index if not exists exp_products_firm on public.exp_products(firm_id);

create table if not exists public.exp_prices (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.exp_products(id) on delete cascade,
  party_id uuid references public.exp_parties(id) on delete cascade, currency text not null default 'INR', rate numeric not null, as_of date, note text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now());
create index if not exists exp_prices_product on public.exp_prices(product_id);

create table if not exists public.exp_countries (
  country text primary key, currency text not null default 'USD', route text, docs text[] not null default '{}', party_ids text[] not null default '{}',
  label_rule text, notes text, created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now());

create table if not exists public.exp_uploads (
  id uuid primary key default gen_random_uuid(), file_name text, rows_read int, added int, updated int, skipped int, summary text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_by_name text, updated_at timestamptz default now());

do $$ declare t text; begin
  foreach t in array array['exp_firms','exp_parties','exp_agents','exp_products','exp_prices','exp_countries','exp_uploads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.exp_stamp()', t||'_stamp', t);
    execute format('create policy %I on public.%I for select using (public.hub_can_export())', t||'_read', t);
    execute format('create policy %I on public.%I for insert with check (public.hub_can_export())', t||'_ins', t);
    if t in ('exp_parties','exp_agents','exp_products') then
      execute format('create policy %I on public.%I for update using (public.hub_can_export()) with check (public.hub_can_export() and (deleted_at is null or public.hub_is_owner()))', t||'_upd', t);
    else
      execute format('create policy %I on public.%I for update using (public.hub_can_export()) with check (public.hub_can_export())', t||'_upd', t);
    end if;
  end loop;
  execute 'create policy exp_prices_del on public.exp_prices for delete using (public.hub_can_export())';
  execute 'create policy exp_countries_del on public.exp_countries for delete using (public.hub_is_owner())';
end $$;

alter publication supabase_realtime add table public.exp_firms, public.exp_parties, public.exp_agents, public.exp_products, public.exp_prices, public.exp_countries;

-- Starting data taken from the shipment documents already on Drive. Everything is editable in the Export tab.
insert into public.exp_firms (id,name,address,phone,email,iec,gstin,pan,dl_no,signatory_name,signatory_title,bank,lut,notes) values
('VH','Velite Healthcare','First Floor, Derma Wing, Grewal Nagar, Hambran 141110, Dist. Ludhiana, Punjab, India','+91-97807-44143','velitehealthcare@yahoo.co.in','3012013458','03ACQPV5065L1ZY',null,'89-COS-PB','Sangeeta Verma','Proprietor',
  '{"bank":"ICICI Bank Ltd., Ludhiana Road, V.P.O. Hambran, Ludhiana 141110","branch":"Hambran","account":"393905000325","ifsc":"","swift":"ICICINBBCTS","ad_code":"6390327"}','{}',
  'Bank IFSC needs a check: invoices print ICIC0003939 but the bank letter of 10-02-2025 says ICIC0006319. Enter the correct one.'),
('VI','Velite India','Grewal Nagar, Hambran, Distt. Ludhiana-141110, Punjab, India','+91-98150-42727','veliteindia@gmail.com','AAYHS5382R','03AAYHS5382R1ZY',null,'20B-136590, 21B-136591','Sanjiv Kumar Verma','Proprietor','{}','{}',
  'Bank details, LUT number and PAN to be entered.')
on conflict (id) do nothing;

insert into public.exp_parties (name,country,roles,address,phone,ids,currency,usual_firm,payment_terms,delivery_terms,entry_point,notes) values
('Nu Derma Enterprises Pvt. Ltd.','Nepal','{buyer,consignee}','Kathmandu MC-18, Bhurungkhel, Kathmandu, Nepal','9856031908, +977 984-6041270','{"PAN":"606692753","EXIM":"6066927530123NP"}','INR','VH','100% before dispatch','Ex-factory Ludhiana, Punjab, India','Sunauli (India) – Bhairahawa (Nepal)','Transport: Pashupati Road Carrier.'),
('Contiderma Nepal Pvt. Ltd.','Nepal','{buyer,consignee}','Ratopul, Kathmandu MC-30, Nepal','+977 985-1071532','{"EXIM":"6103165350101NP"}','INR','VH','100% advance','Ex-factory Ludhiana, Punjab, India','Sunauli (India) – Bhairahawa (Nepal)','PAN to be entered. Earlier papers show the address once as Bhurungkhel: confirm which is right.'),
('P S Cosmo Traders','Nepal','{buyer,consignee}','Madhyapur Thimi 01, Bhaktapur, Nepal','+977 980-1150491','{"PAN":"607260302","EXIM":"6072603020100NP"}','INR','VH','100% advance','Ex-factory Ludhiana, Punjab, India','Jogbani (India) – Biratnagar (Nepal)','Orders come on numbered purchase orders (P.O. 001, 002 …).'),
('Yugantar Holding Pvt. Ltd.','Nepal','{buyer,consignee}','Kathmandu, Nepal','9851005331','{"PAN":"619883391","EXIM":"6198833910154NP"}','INR','VI','50% before production and 50% before dispatch','Ex-factory Ludhiana, Punjab, India','Nepalgunj Road (India) – Nepalgunj (Nepal)','Contract-made Colexi products; one invoice per product.'),
('Sagarmatha Trade Link','Nepal','{buyer,consignee}','Butwal, Rupandehi, Nepal',null,'{"PAN":"304415715","EXIM":"3044157150122NP"}','INR','VI','100% advance','Ex-factory Ludhiana, Punjab, India','Sunauli (India) – Bhairahawa (Nepal)','Earliest Velite India Nepal buyer (2022-23).');

insert into public.exp_agents (name,kind,notes) values
('Pashupati Road Carrier Pvt. Ltd.','transporter','Used for Nepal consignments (Nuderma, Contiderma).'),
('Maa Annapurna Transport Agency Pvt. Ltd.','transporter','Docket seen on Contiderma shipments.'),
('Sugam Parivahan Pvt. Ltd.','transporter','Used for Yugantar (Nepalgunj).'),
('Skyways','cha','Customs agent for Iraq air shipments via Dubai.'),
('Aarvi','cha','Yemen shipments (by road to Mundra, then sea). Confirm role.'),
('WheelsEye','transporter','Yemen road leg. Confirm role.');

insert into public.exp_countries (country,currency,route,docs,party_ids,label_rule,notes) values
('Nepal','INR','By road. Entry point depends on the buyer: Sunauli–Bhairahawa, Nepalgunj Road–Nepalgunj or Jogbani–Biratnagar.',
 '{Proforma invoice,Export invoice (under LUT),Packing list,Certificate of origin,Declaration (not SCOMET / NDPS, no CDSCO NOC),E-invoice and e-way bill,Shipping bill (customs agent),Truck receipt}','{PAN,EXIM}',null,'Starting point from past Nepal shipments. Confirm and edit.'),
('Bangladesh','USD','Purchase-order based.',
 '{Purchase order,Proforma invoice,Export invoice,Packing list,Non-DG certificate,MSDS,COA,Free sale certificate}','{E-TIN,BIN,IRC}','Label: "For sale in Bangladesh only", no MRP.','Starting point. Confirm and edit.'),
('Iraq','USD','By air via Dubai, customs agent Skyways.',
 '{Proforma invoice,Export invoice,Packing list,Non-DG certificate,Narcotics / SCOMET declaration,Free sale certificate,MSDS,COA,Brand-owner carton text}','{}',null,'Starting point. Confirm and edit.'),
('Yemen','USD','By road to Mundra, then by sea. E-way bill needed.',
 '{Proforma invoice,Export invoice,Packing list,Non-DG certificate,Narcotics / SCOMET declaration,Free sale certificate,MSDS,COA,Brand-owner carton text}','{}',null,'Starting point. Confirm and edit.'),
('Myanmar','USD','To be confirmed.',
 '{Proforma invoice,Export invoice,Packing list,Letter of authority,Ingredient list with percentages,MSDS,COA}','{}',null,'Starting point. Confirm and edit.');
