-- Materials v2 (Nov 2026): requirements linked read-only to purchase.velite.in
-- (items, stock, last purchase, PO raised / arrived), firm, for-product, notifications, daily alerts.
-- The bridge key is stored in the vault as 'pv_bridge_key' (set once, outside this file).

create table if not exists public.hub_pv_items (
  id uuid primary key, firm text, name text not null, unit text, item_type text, stock numeric,
  lp_date date, lp_po text, lp_vendor text, lp_qty numeric, lp_unit text, synced_at timestamptz default now());
create index if not exists hub_pv_items_name on public.hub_pv_items (lower(name));
alter table public.hub_pv_items enable row level security;
drop policy if exists hub_pv_items_read on public.hub_pv_items;
create policy hub_pv_items_read on public.hub_pv_items for select to authenticated using (public.hub_is_approved());

-- last purchase rate: owners only
create table if not exists public.hub_pv_prices (item_id uuid primary key, rate numeric, unit text, po_date date, vendor text, po text);
alter table public.hub_pv_prices enable row level security;
drop policy if exists hub_pv_prices_read on public.hub_pv_prices;
create policy hub_pv_prices_read on public.hub_pv_prices for select to authenticated using (public.hub_is_owner());

alter table public.hub_materials
  add column if not exists pv_item_id uuid,
  add column if not exists firm_id text,
  add column if not exists for_product text,
  add column if not exists po_info jsonb,
  add column if not exists late_alerted_at timestamptz,
  add column if not exists due_alerted_at timestamptz;

create or replace function public.hub_pv_firm(c text) returns text language sql immutable as $$
  select case c when 'VPH' then 'VP' when 'VHC' then 'VH' when 'VIN' then 'VI' when 'VSPL' then 'VS' else c end $$;

create or replace function public.hub_pv_call(p_what text, p_since date default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare k text; a text; res record;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'pv_bridge_key';
  select decrypted_secret into a from vault.decrypted_secrets where name = 'pv_anon_key';
  select * into res from extensions.http((
    'POST', 'https://vcwrjwjudaaqionetnez.supabase.co/rest/v1/rpc/hub_bridge',
    array[extensions.http_header('apikey', a), extensions.http_header('Authorization', 'Bearer ' || a)],
    'application/json', jsonb_build_object('p_key', k, 'p_what', p_what, 'p_since', p_since)::text)::extensions.http_request);
  if res.status <> 200 then raise exception 'purchase.velite.in answered %: %', res.status, left(res.content, 200); end if;
  return res.content::jsonb;
end $$;
revoke execute on function public.hub_pv_call(text, date) from anon, authenticated, public;

-- Sync: items + stock + last purchase, then match open requests to POs
create or replace function public.hub_pv_sync(p_items boolean default true) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare j jsonb; pos jsonb; m record; l jsonb; n_items int := 0; n_ord int := 0; n_arr int := 0; since date; full_arrived boolean;
begin
  if auth.uid() is not null and not public.hub_is_approved() then raise exception 'Not allowed'; end if;
  if p_items then
    j := public.hub_pv_call('items');
    insert into public.hub_pv_items(id, firm, name, unit, item_type, stock, lp_date, lp_po, lp_vendor, lp_qty, lp_unit, synced_at)
    select (x->>'id')::uuid, public.hub_pv_firm(x->>'c'), x->>'n', x->>'u', x->>'t', (x->>'s')::numeric,
           (x->'lp'->>'d')::date, x->'lp'->>'po', x->'lp'->>'v', (x->'lp'->>'q')::numeric, x->'lp'->>'u', now()
      from jsonb_array_elements(j) x
    on conflict (id) do update set firm = excluded.firm, name = excluded.name, unit = excluded.unit, item_type = excluded.item_type,
      stock = excluded.stock, lp_date = excluded.lp_date, lp_po = excluded.lp_po, lp_vendor = excluded.lp_vendor,
      lp_qty = excluded.lp_qty, lp_unit = excluded.lp_unit, synced_at = now();
    get diagnostics n_items = row_count;
    delete from public.hub_pv_items where synced_at < now() - interval '1 minute';
    delete from public.hub_pv_prices;
    insert into public.hub_pv_prices(item_id, rate, unit, po_date, vendor, po)
    select (x->>'id')::uuid, (x->'lp'->>'r')::numeric, x->'lp'->>'u', (x->'lp'->>'d')::date, x->'lp'->>'v', x->'lp'->>'po'
      from jsonb_array_elements(j) x where x->'lp' is not null;
  end if;

  select least(coalesce(min(created_at)::date, current_date) - 5, current_date - 30) into since
    from public.hub_materials where deleted_at is null and pv_item_id is not null and status in ('pending','ordered');
  pos := public.hub_pv_call('pos', since);

  for m in select * from public.hub_materials where deleted_at is null and pv_item_id is not null and status in ('pending','ordered') loop
    select x into l from jsonb_array_elements(pos) x
     where (x->>'i')::uuid = m.pv_item_id and (x->>'d')::date >= m.created_at::date - 3
       and (m.po_info is null or x->>'po' = m.po_info->>'po' or m.status = 'pending')
     order by (x->>'d')::date, x->>'po' limit 1;
    continue when l is null;
    full_arrived := (l->>'rq')::numeric >= 0.98 * (l->>'q')::numeric and (l->>'q')::numeric > 0 or l->>'st' = 'Completed';
    update public.hub_materials set
      po_info = l - 'r',
      supplier = coalesce(nullif(supplier,''), l->>'v'),
      po_number = coalesce(nullif(po_number,''), l->>'po'),
      status = case when full_arrived then 'received' else 'ordered' end,
      ordered_at = coalesce(ordered_at, (l->>'d')::timestamptz), ordered_by_name = coalesce(ordered_by_name, 'purchase.velite.in'),
      received_at = case when full_arrived then coalesce(received_at, coalesce((l->>'g')::timestamptz, now())) else received_at end,
      received_by_name = case when full_arrived then coalesce(received_by_name, 'purchase.velite.in') else received_by_name end
     where id = m.id;
    if m.status = 'pending' then n_ord := n_ord + 1; end if;
    if full_arrived then n_arr := n_arr + 1; end if;
  end loop;
  insert into public.hub_cmp_settings(k, v) values ('pv_synced_at', now()::text) on conflict (k) do update set v = excluded.v;
  return jsonb_build_object('items', n_items, 'po_raised', n_ord, 'arrived', n_arr);
end $$;
revoke execute on function public.hub_pv_sync(boolean) from anon, public;
grant execute on function public.hub_pv_sync(boolean) to authenticated;

-- "Refresh now" button: only the PO matching (fast)
create or replace function public.hub_pv_refresh() returns jsonb language sql security definer set search_path to 'public' as $$
  select public.hub_pv_sync(false) $$;
revoke execute on function public.hub_pv_refresh() from anon, public;
grant execute on function public.hub_pv_refresh() to authenticated;

-- ── Notifications for materials ──────────────────────────────────────
create or replace function public.hub_mat_notify() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare o uuid; what text;
begin
  what := new.name || coalesce(' — ' || nullif(new.qty,'') || ' ' || coalesce(new.unit,''), '');
  if tg_op = 'INSERT' then
    for o in select id from public.hub_profiles where role = 'owner' and status = 'approved' loop
      perform public.hub_notify(o, 'material', case when new.urgent then '🚨 URGENT requirement: ' else '📦 New requirement: ' end || what,
        coalesce(new.firm_id || ' · ', '') || case when new.required_by is not null then 'needed by ' || to_char(new.required_by,'DD Mon') else 'no date' end
        || coalesce(' · for ' || nullif(new.for_product,''), ''), 'material', new.id, new.urgent);
    end loop;
    return null;
  end if;
  if new.deleted_at is not null or new.status is not distinct from old.status then return null; end if;
  if new.status = 'ordered' then
    perform public.hub_notify(new.created_by, 'material', '🛒 PO raised: ' || what,
      coalesce(new.po_number, '') || coalesce(' · ' || nullif(new.supplier,''), '') || coalesce(' · expected ' || to_char((new.po_info->>'exp')::date, 'DD Mon'), ''), 'material', new.id, false);
  elsif new.status = 'received' then
    perform public.hub_notify(new.created_by, 'material', '✅ Arrived: ' || what, coalesce(new.supplier, ''), 'material', new.id, false);
  end if;
  return null;
end $$;
drop trigger if exists hub_materials_notify on public.hub_materials;
create trigger hub_materials_notify after insert or update on public.hub_materials for each row execute function public.hub_mat_notify();

-- Daily: needed in 2 days but no PO; delivery late
create or replace function public.hub_mat_daily() returns int
language plpgsql security definer set search_path to 'public' as $$
declare m record; n int := 0;
begin
  for m in select * from public.hub_materials where deleted_at is null and status = 'pending' and required_by is not null
             and required_by <= current_date + 2 and due_alerted_at is null loop
    insert into public.hub_notifications(user_id, kind, title, body, entity_type, entity_id, actor_name)
    select id, 'material', '⏰ Needed by ' || to_char(m.required_by,'DD Mon') || ', no PO yet: ' || m.name, coalesce(m.qty || ' ' || m.unit, ''), 'material', m.id, 'Velite Hub'
      from public.hub_profiles where role = 'owner' and status = 'approved';
    update public.hub_materials set due_alerted_at = now() where id = m.id; n := n + 1;
  end loop;
  for m in select * from public.hub_materials where deleted_at is null and status = 'ordered' and late_alerted_at is null
             and (po_info->>'exp')::date < current_date loop
    insert into public.hub_notifications(user_id, kind, title, body, entity_type, entity_id, actor_name)
    select u, 'material', '🔴 Delivery late: ' || m.name, 'PO ' || coalesce(m.po_number,'') || ' · ' || coalesce(m.supplier,'') || ' · expected ' || to_char((m.po_info->>'exp')::date,'DD Mon'), 'material', m.id, 'Velite Hub'
      from (select m.created_by u union select id from public.hub_profiles where role = 'owner' and status = 'approved') x where u is not null;
    update public.hub_materials set late_alerted_at = now() where id = m.id; n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.hub_mat_daily() from anon, authenticated, public;

-- Morning email part for owners
create or replace function public.hub_mat_digest_html() returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare r record; rows text := ''; n int := 0;
begin
  for r in select name, qty, unit, firm_id, status, urgent, created_at, required_by, po_number, supplier, (po_info->>'exp')::date exp
             from public.hub_materials where deleted_at is null and (
               (status = 'pending' and (urgent or created_at < now() - interval '3 days' or required_by <= current_date + 2))
               or (status = 'ordered' and (po_info->>'exp')::date < current_date))
            order by (status = 'ordered') desc, urgent desc, created_at limit 25 loop
    n := n + 1;
    rows := rows || '<tr><td style="padding:6px;border-bottom:1px solid #f1f5f9;white-space:nowrap"><span style="background:'
      || case when r.status = 'ordered' then '#dc2626' when r.urgent then '#b91c1c' else '#d97706' end
      || ';color:#fff;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:bold">'
      || case when r.status = 'ordered' then 'DELIVERY LATE' when r.urgent then 'URGENT' else 'NO PO · ' || (current_date - r.created_at::date) || ' DAYS' end
      || '</span></td><td style="padding:6px;border-bottom:1px solid #f1f5f9"><b>' || r.name || '</b> ' || coalesce(r.qty || ' ' || r.unit, '')
      || '<div style="font-size:12px;color:#6b7280">' || coalesce(r.firm_id || ' · ', '')
      || case when r.status = 'ordered' then 'PO ' || coalesce(r.po_number,'') || ' · ' || coalesce(r.supplier,'') || ' · expected ' || to_char(r.exp,'DD Mon')
              else coalesce('needed by ' || to_char(r.required_by,'DD Mon'), 'no date') end || '</div></td></tr>';
  end loop;
  if n = 0 then return null; end if;
  return '<div style="font-weight:bold;font-size:15px;margin:16px 0 6px">📦 Material requirements needing action</div><table style="width:100%;border-collapse:collapse;font-size:13px">' || rows || '</table>';
end $$;
revoke execute on function public.hub_mat_digest_html() from anon, authenticated, public;

-- add materials to the owners' part of the morning email (task digest is reused there)
create or replace function public.hub_task_digest_html_all(p_user uuid, p_owner boolean) returns text
language sql stable security definer set search_path to 'public' as $$
  select nullif(concat(public.hub_task_digest_html(p_user, p_owner), case when p_owner then public.hub_mat_digest_html() end), '') $$;
revoke execute on function public.hub_task_digest_html_all(uuid, boolean) from anon, authenticated, public;

do $$ declare d text; begin
  d := pg_get_functiondef('public.hub_cmp_send_reminders(uuid, boolean)'::regprocedure);
  d := replace(d, 't_html := public.hub_task_digest_html(p.id, p.role = ''owner'');', 't_html := public.hub_task_digest_html_all(p.id, p.role = ''owner'');');
  execute d;
  -- email links: materials open the Materials page
  d := pg_get_functiondef('public.hub_notify_send_emails()'::regprocedure);
  d := replace(d, '''<p style="margin:16px 0 0"><a href="https://hub.velite.in/#tasks/'' || coalesce(n.entity_id::text,'''') || ''"',
                  '''<p style="margin:16px 0 0"><a href="https://hub.velite.in/'' || case when n.entity_type = ''material'' then ''#materials'' else ''#tasks/'' || coalesce(n.entity_id::text,'''') end || ''"');
  execute d;
end $$;

-- ── Jobs ─────────────────────────────────────────────────────────────
select cron.unschedule(jobname) from cron.job where jobname in ('hub-pv-sync','hub-pv-items','hub-mat-daily');
select cron.schedule('hub-pv-sync', '*/10 * * * *', $c$select public.hub_pv_sync(false)$c$);
select cron.schedule('hub-pv-items', '5 * * * *', $c$select public.hub_pv_sync(true)$c$);
select cron.schedule('hub-mat-daily', '20 2 * * *', $c$select public.hub_mat_daily()$c$);
do $$ begin begin alter publication supabase_realtime add table public.hub_materials; exception when others then null; end; end $$;
