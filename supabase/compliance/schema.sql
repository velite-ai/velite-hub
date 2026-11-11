-- Compliance Tracker schema (Phase 2)
create table if not exists public.hub_cmp_firms (
  id text primary key, name text not null, constitution text, notes text,
  flags jsonb not null default '{}'::jsonb, sort int default 0, updated_at timestamptz default now());

create table if not exists public.hub_cmp_library (
  code text primary key, dept text not null, title text not null, what text, applies text not null default '',
  rule jsonb not null, risk text default 'M', lead int default 7, law text, authority text, portal text, form text,
  penalty text, evidence text, src text, active boolean default true, sort int default 0, updated_at timestamptz default now());

create table if not exists public.hub_cmp_assign (
  firm_id text references public.hub_cmp_firms(id) on delete cascade,
  code text references public.hub_cmp_library(code) on delete cascade,
  mode text not null default 'auto' check (mode in ('auto','yes','no')),
  na_reason text, owner_id uuid references public.hub_profiles(id) on delete set null,
  checker_id uuid references public.hub_profiles(id) on delete set null, owner_ext text,
  updated_at timestamptz default now(), primary key (firm_id, code));

create table if not exists public.hub_cmp_licences (
  id uuid primary key default gen_random_uuid(),
  firm_id text not null references public.hub_cmp_firms(id),
  code text references public.hub_cmp_library(code) on delete set null,
  title text not null, number text, authority text, issued_on date, valid_till date,
  next_due date, notes text, proof_link text, proof_path text, proof_name text,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_at timestamptz,
  deleted_at timestamptz, deleted_by_name text);

create table if not exists public.hub_cmp_items (
  id uuid primary key default gen_random_uuid(),
  firm_id text not null references public.hub_cmp_firms(id),
  code text not null references public.hub_cmp_library(code),
  licence_id uuid references public.hub_cmp_licences(id) on delete cascade,
  period_key text not null, period_label text, due_date date not null,
  status text not null default 'pending' check (status in ('pending','in_progress','filed','verified','na')),
  owner_id uuid references public.hub_profiles(id) on delete set null,
  checker_id uuid references public.hub_profiles(id) on delete set null,
  filed_on date, ref_no text, proof_link text, proof_path text, proof_name text, notes text, na_reason text,
  filed_by_name text, filed_at timestamptz, verified_by_name text, verified_at timestamptz,
  manual boolean default false, reminded_at timestamptz,
  created_by uuid, created_by_name text, created_at timestamptz default now(), updated_at timestamptz,
  deleted_at timestamptz, deleted_by_name text,
  unique (firm_id, code, period_key));
create index if not exists hub_cmp_items_due on public.hub_cmp_items(due_date) where deleted_at is null;

-- ── helpers ──
create or replace function public.hub_cmp_applies(p_flags jsonb, p_expr text) returns boolean
language plpgsql immutable as $$
declare part text; tok text; ok boolean; neg boolean; v boolean;
begin
  if coalesce(p_expr,'') = '' then return true; end if;
  foreach part in array string_to_array(p_expr, '|') loop
    ok := true;
    foreach tok in array string_to_array(part, '&') loop
      tok := trim(tok); neg := left(tok,1) = '!'; if neg then tok := substr(tok,2); end if;
      v := coalesce((p_flags->>tok)::boolean, false);
      if neg then v := not v; end if;
      if not v then ok := false; exit; end if;
    end loop;
    if ok then return true; end if;
  end loop;
  return false;
end $$;

create or replace function public.hub_cmp_mkdate(y int, m int, d int) returns date
language sql immutable as $$
  select make_date(y, m, least(d, extract(day from (make_date(y,m,1) + interval '1 month - 1 day'))::int)) $$;

create or replace function public.hub_cmp_fy(y int) returns text language sql immutable as $$
  select 'FY ' || y || '-' || lpad(((y+1) % 100)::text, 2, '0') $$;

-- All due dates a rule produces inside [p_from, p_to]
create or replace function public.hub_cmp_dates(p_rule jsonb, p_from date, p_to date)
returns table(period_key text, period_label text, due date)
language plpgsql stable as $$
declare t text := p_rule->>'t'; s date; e date; idx int; lag int; dd int; fy int; ov jsonb; y int; it jsonb; md text;
  lbl text; cal boolean := coalesce((p_rule->>'cal')::boolean,false);
begin
  if t = 'monthly' then
    s := date_trunc('month', p_from - interval '4 months')::date;
    while s <= p_to loop
      idx := extract(month from s);
      if not (coalesce((p_rule->>'skipQEnd')::boolean,false) and idx in (3,6,9,12)) then
        ov := p_rule->'ovr'->(idx::text);
        lag := coalesce((ov->>'lag')::int, (p_rule->>'lag')::int, 1);
        dd := coalesce((ov->>'d')::int, (p_rule->>'d')::int);
        e := (s + make_interval(months => lag))::date;
        due := public.hub_cmp_mkdate(extract(year from e)::int, extract(month from e)::int, dd);
        if due between p_from and p_to then
          period_key := to_char(s,'YYYY-MM'); period_label := to_char(s,'Mon YYYY'); return next; end if;
      end if;
      s := (s + interval '1 month')::date;
    end loop;
  elsif t in ('quarterly','half') then
    s := date_trunc('month', p_from - interval '13 months')::date;
    while s <= p_to loop
      idx := extract(month from s);
      if (t = 'quarterly' and idx in (1,4,7,10)) or (t = 'half' and ((not cal and idx in (4,10)) or (cal and idx in (1,7)))) then
        if t = 'quarterly' then idx := case idx when 4 then 1 when 7 then 2 when 10 then 3 else 4 end;
        elsif cal then idx := case idx when 1 then 1 else 2 end;
        else idx := case idx when 4 then 1 else 2 end; end if;
        if p_rule ? 'only' and not (p_rule->'only' @> to_jsonb(idx)) then s := (s + interval '1 month')::date; continue; end if;
        ov := p_rule->'ovr'->(idx::text);
        lag := coalesce((ov->>'lag')::int, (p_rule->>'lag')::int, 1);
        dd := coalesce((ov->>'d')::int, (p_rule->>'d')::int);
        e := (s + make_interval(months => (case when t='quarterly' then 2 else 5 end) + lag))::date;
        due := public.hub_cmp_mkdate(extract(year from e)::int, extract(month from e)::int, dd);
        fy := extract(year from s)::int - (case when not cal and extract(month from s) < 4 then 1 else 0 end);
        if due between p_from and p_to then
          if t = 'quarterly' then period_key := fy || '-Q' || idx; period_label := 'Q' || idx || ' ' || public.hub_cmp_fy(fy);
          elsif cal then period_key := fy || '-CH' || idx; period_label := case idx when 1 then 'Jan–Jun ' else 'Jul–Dec ' end || fy;
          else period_key := fy || '-H' || idx; period_label := case idx when 1 then 'Apr–Sep ' else 'Oct–Mar ' end || public.hub_cmp_fy(fy); end if;
          return next;
        end if;
      end if;
      s := (s + interval '1 month')::date;
    end loop;
  elsif t = 'yearly' then
    for y in extract(year from p_from)::int - 1 .. extract(year from p_to)::int + 1 loop
      idx := (p_rule->>'m')::int;
      due := coalesce((p_rule->'ovr'->>(y::text))::date, public.hub_cmp_mkdate(y, idx, (p_rule->>'d')::int));
      lbl := coalesce(p_rule->>'label','year');
      period_label := case lbl
        when 'fy_prev' then public.hub_cmp_fy(case when idx >= 4 then y-1 else y-2 end)
        when 'fy_cur'  then public.hub_cmp_fy(case when idx >= 4 then y else y-1 end)
        when 'fy_next' then public.hub_cmp_fy(case when idx >= 4 then y+1 else y end)
        when 'cal_prev' then 'Year ' || (y-1)
        else y::text end;
      period_key := 'Y' || y;
      if due between p_from and p_to then return next; end if;
    end loop;
  elsif t = 'dates' then
    for y in extract(year from p_from)::int .. extract(year from p_to)::int + 1 loop
      for it in select * from jsonb_array_elements(p_rule->'list') loop
        md := it->>0;
        due := public.hub_cmp_mkdate(y, split_part(md,'-',1)::int, split_part(md,'-',2)::int);
        period_key := 'D' || y || '-' || md; period_label := (it->>1) || ' ' || y;
        if due between p_from and p_to then return next; end if;
      end loop;
    end loop;
  elsif t = 'once' then
    due := (p_rule->>'date')::date; period_key := 'ONCE'; period_label := 'One-time';
    if due >= p_from then return next; end if;   -- keep one-time deadlines however far
  end if;
end $$;

-- Effective owner/checker per firm & item
create or replace view public.hub_cmp_applicable with (security_invoker = true) as
  select f.id firm_id, l.code, coalesce(a.mode,'auto') mode,
    case coalesce(a.mode,'auto') when 'yes' then true when 'no' then false
      else public.hub_cmp_applies(f.flags, l.applies) end as applicable,
    public.hub_cmp_applies(f.flags, l.applies) as auto_applicable,
    a.na_reason, a.owner_id, a.checker_id, a.owner_ext
  from public.hub_cmp_firms f cross join public.hub_cmp_library l
  left join public.hub_cmp_assign a on a.firm_id = f.id and a.code = l.code
  where l.active;

-- Create next 12 months of due items (idempotent). Safe to run any time.
create or replace function public.hub_cmp_generate(p_days int default 370) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int := 0; c int; r record; d record; lic record;
begin
  if auth.uid() is not null and not public.hub_is_approved() then raise exception 'Not allowed'; end if;
  for r in select ap.*, l.rule from public.hub_cmp_applicable ap join public.hub_cmp_library l using (code)
           where ap.applicable and l.rule->>'t' not in ('licence','event') loop
    for d in select * from public.hub_cmp_dates(r.rule, current_date, current_date + p_days) loop
      insert into public.hub_cmp_items(firm_id, code, period_key, period_label, due_date, owner_id, checker_id)
      values (r.firm_id, r.code, d.period_key, d.period_label, d.due, r.owner_id, r.checker_id)
      on conflict (firm_id, code, period_key) do nothing;
      get diagnostics c = row_count; n := n + c;
    end loop;
  end loop;
  -- licence-driven
  for lic in select li.*, ap.owner_id ow, ap.checker_id ck from public.hub_cmp_licences li
             left join public.hub_cmp_applicable ap on ap.firm_id = li.firm_id and ap.code = li.code
             where li.deleted_at is null and li.next_due is not null and li.code is not null
               and li.next_due <= current_date + p_days loop
    insert into public.hub_cmp_items(firm_id, code, licence_id, period_key, period_label, due_date, owner_id, checker_id)
    values (lic.firm_id, lic.code, lic.id, 'L:' || lic.id || ':' || lic.next_due, lic.title || coalesce(' · ' || lic.number,''), lic.next_due, lic.ow, lic.ck)
    on conflict (firm_id, code, period_key) do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  -- remove untouched future items that are no longer applicable (e.g. flag switched off)
  delete from public.hub_cmp_items i using public.hub_cmp_applicable ap
   where ap.firm_id = i.firm_id and ap.code = i.code and not ap.applicable
     and i.status = 'pending' and not i.manual and i.licence_id is null and i.due_date >= current_date
     and i.ref_no is null and i.proof_link is null and i.proof_path is null and i.notes is null;
  return n;
end $$;

-- Stamping (names/dates cannot be faked from the browser)
create or replace function public.hub_cmp_stamp() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare me text := public.hub_my_name();
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := me; new.created_at := now(); new.deleted_at := null;
  else
    new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at; new.updated_at := now();
    if new.deleted_at is not null and old.deleted_at is null then new.deleted_at := now(); new.deleted_by_name := me;
    elsif new.deleted_at is null then new.deleted_by_name := null; end if;
  end if;
  if tg_table_name = 'hub_cmp_items' then
    if tg_op = 'UPDATE' then
      new.firm_id := old.firm_id; new.code := old.code; new.period_key := old.period_key;
      if not public.hub_is_owner() then new.due_date := old.due_date; end if;
    end if;
    if new.status in ('filed','verified') and (tg_op = 'INSERT' or old.status not in ('filed','verified')) then
      new.filed_by_name := me; new.filed_at := now(); new.filed_on := coalesce(new.filed_on, current_date);
    elsif new.status not in ('filed','verified') then
      new.filed_by_name := null; new.filed_at := null;
    end if;
    if new.status = 'verified' and (tg_op = 'INSERT' or old.status <> 'verified') then
      if not (public.hub_is_owner() or new.checker_id = auth.uid()) then raise exception 'Only the checker or an owner can verify'; end if;
      new.verified_by_name := me; new.verified_at := now();
    elsif new.status <> 'verified' then new.verified_by_name := null; new.verified_at := null; end if;
    if new.status = 'na' and (tg_op = 'INSERT' or old.status <> 'na') then
      if not public.hub_is_owner() then raise exception 'Only an owner can mark Not applicable'; end if;
      if coalesce(trim(new.na_reason),'') = '' then raise exception 'Give a reason for Not applicable'; end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists hub_cmp_items_stamp on public.hub_cmp_items;
create trigger hub_cmp_items_stamp before insert or update on public.hub_cmp_items for each row execute function public.hub_cmp_stamp();
drop trigger if exists hub_cmp_licences_stamp on public.hub_cmp_licences;
create trigger hub_cmp_licences_stamp before insert or update on public.hub_cmp_licences for each row execute function public.hub_cmp_stamp();

-- Activity log
create or replace function public.hub_cmp_log() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare act text; lbl text;
begin
  if auth.uid() is null then return null; end if;
  if tg_table_name = 'hub_cmp_items' then
    lbl := new.firm_id || ' · ' || coalesce((select title from public.hub_cmp_library where code = new.code), new.code) || ' · ' || coalesce(new.period_label,'');
    if tg_op = 'INSERT' then act := 'created';
    elsif new.deleted_at is not null and old.deleted_at is null then act := 'deleted';
    elsif new.status is distinct from old.status then act := 'status: ' || new.status;
    else act := 'edited'; end if;
    if tg_op = 'INSERT' and not new.manual then return null; end if;
    insert into public.hub_activity(actor_id, actor_name, entity_type, entity_id, action, summary)
    values (auth.uid(), public.hub_my_name(), 'compliance', new.id, act, left(lbl, 200));
  else
    lbl := new.firm_id || ' · ' || new.title;
    act := case when tg_op = 'INSERT' then 'created' when new.deleted_at is not null and old.deleted_at is null then 'deleted' else 'edited' end;
    insert into public.hub_activity(actor_id, actor_name, entity_type, entity_id, action, summary)
    values (auth.uid(), public.hub_my_name(), 'licence', new.id, act, left(lbl, 200));
  end if;
  return null;
end $$;
drop trigger if exists hub_cmp_items_log on public.hub_cmp_items;
create trigger hub_cmp_items_log after insert or update on public.hub_cmp_items for each row execute function public.hub_cmp_log();
drop trigger if exists hub_cmp_licences_log on public.hub_cmp_licences;
create trigger hub_cmp_licences_log after insert or update on public.hub_cmp_licences for each row execute function public.hub_cmp_log();

-- Licence changes regenerate items
create or replace function public.hub_cmp_licence_regen() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' and (new.next_due is distinct from old.next_due or new.deleted_at is not null) then
    delete from public.hub_cmp_items where licence_id = new.id and status = 'pending'
      and (new.deleted_at is not null or period_key <> 'L:' || new.id || ':' || coalesce(new.next_due::text,''));
  end if;
  perform public.hub_cmp_generate();
  return null;
end $$;
drop trigger if exists hub_cmp_licences_regen on public.hub_cmp_licences;
create trigger hub_cmp_licences_regen after insert or update on public.hub_cmp_licences for each row execute function public.hub_cmp_licence_regen();

-- RLS
alter table public.hub_cmp_firms enable row level security;
alter table public.hub_cmp_library enable row level security;
alter table public.hub_cmp_assign enable row level security;
alter table public.hub_cmp_licences enable row level security;
alter table public.hub_cmp_items enable row level security;
do $$ declare t text; begin
  foreach t in array array['hub_cmp_firms','hub_cmp_library','hub_cmp_assign','hub_cmp_licences','hub_cmp_items'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.hub_is_approved())', t||'_read', t);
  end loop;
  foreach t in array array['hub_cmp_firms','hub_cmp_library','hub_cmp_assign'] loop
    execute format('drop policy if exists %I on public.%I', t||'_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.hub_is_owner()) with check (public.hub_is_owner())', t||'_owner', t);
  end loop;
  foreach t in array array['hub_cmp_licences','hub_cmp_items'] loop
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.hub_is_approved())', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.hub_is_approved()) with check (public.hub_is_approved())', t||'_upd', t);
  end loop;
end $$;

revoke execute on function public.hub_cmp_generate(int) from anon, public;
grant execute on function public.hub_cmp_generate(int) to authenticated;

-- Realtime
do $$ begin
  begin alter publication supabase_realtime add table public.hub_cmp_items; exception when others then null; end;
  begin alter publication supabase_realtime add table public.hub_cmp_licences; exception when others then null; end;
  begin alter publication supabase_realtime add table public.hub_cmp_assign; exception when others then null; end;
  begin alter publication supabase_realtime add table public.hub_cmp_firms; exception when others then null; end;
end $$;

-- Private storage bucket for proofs
insert into storage.buckets (id, name, public, file_size_limit) values ('compliance','compliance', false, 15728640)
on conflict (id) do nothing;
drop policy if exists hub_cmp_files_read on storage.objects;
create policy hub_cmp_files_read on storage.objects for select to authenticated using (bucket_id = 'compliance' and public.hub_is_approved());
drop policy if exists hub_cmp_files_write on storage.objects;
create policy hub_cmp_files_write on storage.objects for insert to authenticated with check (bucket_id = 'compliance' and public.hub_is_approved());

-- Nightly: create new due items
select cron.unschedule('hub-cmp-generate') where exists (select 1 from cron.job where jobname='hub-cmp-generate');
select cron.schedule('hub-cmp-generate', '0 21 * * *', $$select public.hub_cmp_generate()$$);

-- Comments on compliance items
alter table public.hub_comments drop constraint if exists hub_comments_entity_type_check;
alter table public.hub_comments add constraint hub_comments_entity_type_check
  check (entity_type in ('material','task','goal','trademark','compliance'));

-- hardening (applied 2026-11-08)
alter function public.hub_cmp_applies(jsonb,text) set search_path = public;
alter function public.hub_cmp_mkdate(int,int,int) set search_path = public;
alter function public.hub_cmp_fy(int) set search_path = public;
alter function public.hub_cmp_dates(jsonb,date,date) set search_path = public;
revoke execute on function public.hub_cmp_stamp() from anon, authenticated, public;
revoke execute on function public.hub_cmp_log() from anon, authenticated, public;
revoke execute on function public.hub_cmp_licence_regen() from anon, authenticated, public;

-- 2026-11-08 review: hub_cmp_generate(p_days, p_back) with backfill; hub_cmp_renew_licence; hub_cmp_mark_predone
-- (see migration hub_compliance_generate_backfill)
-- 2026-11-08: email reminders — see migration hub_compliance_email_reminders (hub_cmp_send_reminders, daily 08:00 IST via pg_cron, Resend key in Vault as 'resend_api_key')

-- Department checklists (Nov 2026): see checklists.sql (tables hub_chk_points / hub_chk_answers / hub_chk_heads / hub_chk_log,
-- functions hub_chk_answer / hub_chk_confirm / hub_chk_recheck / hub_chk_send_scorecard, cron 'hub-chk-scorecard').
-- Points are loaded from checks.json (built from checks.mjs) by upsert on code.

-- Papers chain (Nov 2026): hub_cmp_docs — any number of dated papers per licence (parent_type 'licence', parent_id = licence id)
-- or per checklist point (parent_type 'check', parent_id = 'FIRM|CODE'). Stamped by hub_cmp_docs_stamp; soft delete by owner or uploader.
