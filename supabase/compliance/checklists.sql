-- Department-wise checklists (standing "must have" points), Nov 2026
create table if not exists public.hub_chk_points (
  code text primary key, dept text not null, q text not null, why text, law text, applies text not null default '',
  tags text[] not null default '{}', risk text default 'M', evidence text, sort int default 0, active boolean default true,
  updated_at timestamptz default now());

create table if not exists public.hub_chk_answers (
  firm_id text not null references public.hub_cmp_firms(id) on delete cascade,
  code text not null references public.hub_chk_points(code) on delete cascade,
  answer text not null check (answer in ('yes','no','na')),
  note text, ref_no text, proof_link text, proof_path text, proof_name text,
  action_owner uuid references public.hub_profiles(id) on delete set null, action_due date,
  item_id uuid references public.hub_cmp_items(id) on delete set null,
  stale boolean not null default false, stale_reason text,
  answered_by uuid, answered_by_name text, answered_at timestamptz not null default now(),
  primary key (firm_id, code));

create table if not exists public.hub_chk_heads (
  firm_id text not null references public.hub_cmp_firms(id) on delete cascade, dept text not null,
  head_id uuid references public.hub_profiles(id) on delete set null, updated_at timestamptz default now(),
  primary key (firm_id, dept));

create table if not exists public.hub_chk_log (
  id bigint generated always as identity primary key, firm_id text not null, code text not null,
  answer text, note text, by_name text, at timestamptz default now());

alter table public.hub_chk_points enable row level security;
alter table public.hub_chk_answers enable row level security;
alter table public.hub_chk_heads enable row level security;
alter table public.hub_chk_log enable row level security;
do $$ declare t text; begin
  foreach t in array array['hub_chk_points','hub_chk_answers','hub_chk_heads','hub_chk_log'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.hub_is_approved())', t||'_read', t);
  end loop;
  foreach t in array array['hub_chk_points','hub_chk_heads'] loop
    execute format('drop policy if exists %I on public.%I', t||'_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.hub_is_owner()) with check (public.hub_is_owner())', t||'_owner', t);
  end loop;
end $$;
-- answers and log are written only through the functions below (names and dates cannot be faked)

create or replace function public.hub_chk_fy_start() returns date language sql stable as $$
  select make_date(extract(year from current_date)::int - case when extract(month from current_date) < 4 then 1 else 0 end, 4, 1) $$;

-- One row per firm x applicable point, with the answer that counts today (old-year or re-check answers count as blank)
create or replace view public.hub_chk_status with (security_invoker = true) as
  select f.id as firm_id, p.code, p.dept, p.risk, p.sort,
         case when a.answer is null or a.stale or a.answered_at < public.hub_chk_fy_start() then null else a.answer end as answer,
         a.action_owner, a.action_due
    from public.hub_cmp_firms f
    join public.hub_chk_points p on p.active and public.hub_cmp_applies(f.flags, p.applies)
    left join public.hub_chk_answers a on a.firm_id = f.id and a.code = p.code;

create or replace function public.hub_chk_answer(p_firm text, p_code text, p_answer text, p_note text default null,
  p_ref text default null, p_link text default null, p_path text default null, p_name text default null,
  p_owner uuid default null, p_due date default null) returns void
language plpgsql security definer set search_path to 'public' as $$
declare pt record; me text := public.hub_my_name(); own uuid; it uuid; pk text := 'CK:' || p_code;
begin
  if not public.hub_is_approved() then raise exception 'Not allowed'; end if;
  select * into pt from public.hub_chk_points where code = p_code;
  if pt.code is null then raise exception 'Unknown checklist point'; end if;
  p_note := nullif(trim(coalesce(p_note,'')),''); p_ref := nullif(trim(coalesce(p_ref,'')),''); p_link := nullif(trim(coalesce(p_link,'')),'');
  if p_answer = 'yes' and p_ref is null and p_link is null and p_path is null then raise exception 'Add proof for Yes: a file, a link or a reference number'; end if;
  if p_answer = 'na' and p_note is null then raise exception 'Give a reason for Not applicable'; end if;
  if p_answer = 'no' and p_due is null then raise exception 'Give a date by which this will be fixed'; end if;
  if p_answer not in ('yes','no','na') then raise exception 'Bad answer'; end if;

  select id into it from public.hub_cmp_items where firm_id = p_firm and code = 'CK01' and period_key = pk;
  if p_answer = 'no' then
    own := coalesce(p_owner, (select head_id from public.hub_chk_heads where firm_id = p_firm and dept = pt.dept));
    if it is null then
      insert into public.hub_cmp_items(firm_id, code, period_key, period_label, due_date, owner_id, manual, notes)
      values (p_firm, 'CK01', pk, left(pt.dept || ' · ' || pt.q, 180), p_due, own, true, p_note) returning id into it;
    else
      update public.hub_cmp_items set status = 'pending', due_date = p_due, owner_id = own, deleted_at = null, notes = p_note,
             ref_no = null, proof_link = null, proof_path = null, proof_name = null, filed_on = null, reminded_at = null where id = it;
    end if;
  elsif it is not null then
    if p_answer = 'yes' then
      update public.hub_cmp_items set status = 'filed', ref_no = p_ref, proof_link = p_link, proof_path = p_path, proof_name = p_name
       where id = it and status in ('pending','in_progress') and deleted_at is null;
    else
      update public.hub_cmp_items set deleted_at = now() where id = it and status in ('pending','in_progress') and deleted_at is null;
    end if;
  end if;

  insert into public.hub_chk_answers(firm_id, code, answer, note, ref_no, proof_link, proof_path, proof_name, action_owner, action_due, item_id, stale, stale_reason, answered_by, answered_by_name, answered_at)
  values (p_firm, p_code, p_answer, p_note, p_ref, p_link, p_path, p_name, case when p_answer = 'no' then own end, case when p_answer = 'no' then p_due end, it, false, null, auth.uid(), me, now())
  on conflict (firm_id, code) do update set answer = excluded.answer, note = excluded.note, ref_no = excluded.ref_no, proof_link = excluded.proof_link,
    proof_path = excluded.proof_path, proof_name = excluded.proof_name, action_owner = excluded.action_owner, action_due = excluded.action_due,
    item_id = excluded.item_id, stale = false, stale_reason = null, answered_by = excluded.answered_by, answered_by_name = excluded.answered_by_name, answered_at = now();
  insert into public.hub_chk_log(firm_id, code, answer, note, by_name) values (p_firm, p_code, p_answer, coalesce(p_note, p_ref, p_link, p_name), me);
end $$;

-- "Still the same" — one click to re-confirm a Yes / Not-applicable answer in the yearly self-audit
create or replace function public.hub_chk_confirm(p_firm text, p_codes text[]) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int; me text := public.hub_my_name();
begin
  if not public.hub_is_approved() then raise exception 'Not allowed'; end if;
  update public.hub_chk_answers set stale = false, stale_reason = null, answered_at = now(), answered_by = auth.uid(), answered_by_name = me
   where firm_id = p_firm and code = any(p_codes) and answer in ('yes','na');
  get diagnostics n = row_count;
  insert into public.hub_chk_log(firm_id, code, answer, note, by_name)
    select p_firm, c, 're-confirmed', null, me from unnest(p_codes) c;
  return n;
end $$;

-- Ask for a fresh check of one department (new product, machine, premises, people...). Owner or that department's head.
create or replace function public.hub_chk_recheck(p_firm text, p_dept text, p_reason text) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not (public.hub_is_owner() or exists (select 1 from public.hub_chk_heads where firm_id = p_firm and dept = p_dept and head_id = auth.uid())) then
    raise exception 'Only an owner or the department head can ask for a re-check'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Say what changed'; end if;
  update public.hub_chk_answers a set stale = true, stale_reason = left(p_reason, 200)
   from public.hub_chk_points p where p.code = a.code and p.dept = p_dept and a.firm_id = p_firm and a.answer in ('yes','na');
  get diagnostics n = row_count;
  insert into public.hub_chk_log(firm_id, code, answer, note, by_name) values (p_firm, '*' || p_dept, 're-check', left(p_reason,200), public.hub_my_name());
  return n;
end $$;

-- When the action for a "No" is marked done (with proof), the checklist point turns to Yes
create or replace function public.hub_chk_item_done() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.code = 'CK01' and new.status in ('filed','verified') and old.status not in ('filed','verified') then
    update public.hub_chk_answers set answer = 'yes', ref_no = new.ref_no, proof_link = new.proof_link, proof_path = new.proof_path, proof_name = new.proof_name,
           note = nullif(trim('Gap closed. ' || coalesce(new.notes,'')),''), stale = false, answered_by_name = coalesce(new.filed_by_name, answered_by_name), answered_at = now()
     where firm_id = new.firm_id and code = substr(new.period_key, 4) and answer = 'no';
    if found then insert into public.hub_chk_log(firm_id, code, answer, note, by_name) values (new.firm_id, substr(new.period_key,4), 'yes', 'Gap closed', new.filed_by_name); end if;
  end if;
  return null;
end $$;
drop trigger if exists hub_chk_item_done on public.hub_cmp_items;
create trigger hub_chk_item_done after update on public.hub_cmp_items for each row execute function public.hub_chk_item_done();

-- Monthly one-page scorecard to owners
create or replace function public.hub_chk_scorecard_html(p_name text) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare h text; r record; f record; cell record; gaps text := ''; g record; tot record;
begin
  select count(*) t, count(*) filter (where answer in ('yes','na')) ok, count(*) filter (where answer = 'no') no into tot from public.hub_chk_status;
  h := '<div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#1f2937">'
    || '<div style="background:#1d4ed8;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><div style="font-size:19px;font-weight:bold">Velite compliance scorecard — ' || to_char(current_date,'FMMonth YYYY') || '</div>'
    || '<div style="font-size:13px;opacity:.9">Hello ' || coalesce(p_name,'') || '. ' || tot.ok || ' of ' || tot.t || ' checklist points are in order (' || case when tot.t > 0 then round(100.0*tot.ok/tot.t) else 0 end || '%). ' || tot.no || ' gaps are open.</div></div>'
    || '<table style="border-collapse:collapse;width:100%;font-size:13px"><tr><th style="text-align:left;padding:6px 8px;border:1px solid #e5e7eb;background:#f3f4f6">Department</th>';
  for f in select id from public.hub_cmp_firms order by sort loop h := h || '<th style="padding:6px 8px;border:1px solid #e5e7eb;background:#f3f4f6;width:70px">' || f.id || '</th>'; end loop;
  h := h || '</tr>';
  for r in select dept, min(sort) s from public.hub_chk_status group by dept order by 2 loop
    h := h || '<tr><td style="padding:6px 8px;border:1px solid #e5e7eb">' || r.dept || '</td>';
    for f in select id from public.hub_cmp_firms order by sort loop
      select count(*) t, count(*) filter (where answer in ('yes','na')) ok, count(*) filter (where answer = 'no') no,
             count(*) filter (where answer = 'no' and risk = 'H') noh into cell from public.hub_chk_status where firm_id = f.id and dept = r.dept;
      h := h || '<td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:center;font-weight:bold;' ||
        case when cell.t = 0 then 'color:#d1d5db">–'
             when cell.ok = cell.t then 'background:#dcfce7;color:#166534">' || cell.ok || '/' || cell.t
             when cell.noh > 0 then 'background:#fee2e2;color:#991b1b">' || cell.ok || '/' || cell.t
             when cell.ok + cell.no = 0 then 'background:#f3f4f6;color:#6b7280">0/' || cell.t
             else 'background:#fef3c7;color:#92400e">' || cell.ok || '/' || cell.t end || '</td>';
    end loop;
    h := h || '</tr>';
  end loop;
  h := h || '</table><div style="font-size:12px;color:#6b7280;padding:6px 2px">Green = all in order · Amber = work pending · Red = a high-risk gap is open · Grey = not started</div>';
  for g in select s.firm_id, s.dept, p.q, s.risk, s.action_due, (select full_name from public.hub_profiles x where x.id = s.action_owner) who
             from public.hub_chk_status s join public.hub_chk_points p using (code) where s.answer = 'no'
            order by (s.risk = 'H') desc, s.action_due nulls last limit 15 loop
    gaps := gaps || '<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;font-weight:bold">' || g.firm_id || '</td><td style="padding:5px 8px;border-bottom:1px solid #eee">' || g.q
         || '<div style="color:#6b7280;font-size:12px">' || g.dept || case when g.risk = 'H' then ' · <span style="color:#b91c1c">High risk</span>' else '' end || '</div></td><td style="padding:5px 8px;border-bottom:1px solid #eee;white-space:nowrap">'
         || coalesce(g.who,'No one') || '<br>' || coalesce(to_char(g.action_due,'DD Mon'),'') || case when g.action_due < current_date then ' <span style="color:#b91c1c">late</span>' else '' end || '</td></tr>';
  end loop;
  if gaps <> '' then h := h || '<div style="font-weight:bold;margin:14px 0 4px">Open gaps (most serious first)</div><table style="border-collapse:collapse;width:100%;font-size:13px">' || gaps || '</table>'; end if;
  return h || '<p style="margin-top:16px"><a href="https://hub.velite.in/#compliance" style="background:#1d4ed8;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">Open Velite Hub</a></p></div>';
end $$;

create or replace function public.hub_chk_send_scorecard(p_only uuid default null) returns int
language plpgsql security definer set search_path to 'public' as $$
declare p record; n int := 0;
begin
  if auth.uid() is not null and not public.hub_is_owner() then raise exception 'Only an owner can send the scorecard'; end if;
  if p_only is null and coalesce((select v from public.hub_cmp_settings where k='email_enabled'),'false') <> 'true' then return 0; end if;
  for p in select * from public.hub_profiles where status = 'approved' and coalesce(email,'') <> '' and (id = p_only or (p_only is null and role = 'owner')) loop
    perform public.hub_cmp_mail_send(p.email, '📊 Velite compliance scorecard — ' || to_char(current_date,'FMMonth YYYY'), public.hub_chk_scorecard_html(p.full_name), 0, case when p_only is null then 'scorecard' else 'test' end);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.hub_chk_answer(text,text,text,text,text,text,text,text,uuid,date), public.hub_chk_confirm(text,text[]), public.hub_chk_recheck(text,text,text), public.hub_chk_send_scorecard(uuid), public.hub_chk_scorecard_html(text) from anon, public;
grant execute on function public.hub_chk_answer(text,text,text,text,text,text,text,text,uuid,date), public.hub_chk_confirm(text,text[]), public.hub_chk_recheck(text,text,text), public.hub_chk_send_scorecard(uuid) to authenticated;
revoke execute on function public.hub_chk_item_done() from anon, authenticated, public;

do $$ begin
  begin alter publication supabase_realtime add table public.hub_chk_answers; exception when others then null; end;
  begin alter publication supabase_realtime add table public.hub_chk_heads; exception when others then null; end;
end $$;

-- 1st of every month, 08:05 IST
select cron.unschedule('hub-chk-scorecard') where exists (select 1 from cron.job where jobname = 'hub-chk-scorecard');
select cron.schedule('hub-chk-scorecard', '35 2 1 * *', $c$select public.hub_chk_send_scorecard()$c$);

-- New firm settings: Velite India trades in food; Velite Healthcare uses plant-based cosmetic ingredients
update public.hub_cmp_firms set flags = flags || '{"food": true}'::jsonb where id = 'VI';
update public.hub_cmp_firms set flags = flags || '{"botanical": true}'::jsonb where id = 'VH';
