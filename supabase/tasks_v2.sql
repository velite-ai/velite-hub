-- Task Manager v2 (Nov 2026): helpers, firm, Waiting status, checklist, files, repeat, seen, done note,
-- in-app notifications (bell) + email queue, daily due/overdue alerts and auto-escalation, morning digest.

alter table public.hub_tasks
  add column if not exists helper_ids uuid[] not null default '{}',
  add column if not exists firm_id text,
  add column if not exists checklist jsonb not null default '[]',
  add column if not exists files jsonb not null default '[]',
  add column if not exists repeat text check (repeat in ('daily','weekly','monthly','quarterly','yearly')),
  add column if not exists repeat_from uuid,
  add column if not exists seen_at timestamptz,
  add column if not exists done_note text,
  add column if not exists escalated_at timestamptz,
  add column if not exists started_at timestamptz;

-- ── Notifications (bell) ─────────────────────────────────────────────
create table if not exists public.hub_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.hub_profiles(id) on delete cascade,
  kind text not null, title text not null, body text, entity_type text, entity_id uuid,
  actor_name text, created_at timestamptz not null default now(), read_at timestamptz,
  email_status text, email_sent_at timestamptz);   -- email_status: null = no email, 'pending', or the HTTP status
create index if not exists hub_notif_user on public.hub_notifications(user_id, created_at desc);
create index if not exists hub_notif_pending on public.hub_notifications(email_status) where email_status = 'pending';
alter table public.hub_notifications enable row level security;
drop policy if exists hub_notif_read on public.hub_notifications;
create policy hub_notif_read on public.hub_notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists hub_notif_mark on public.hub_notifications;
create policy hub_notif_mark on public.hub_notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
do $$ begin begin alter publication supabase_realtime add table public.hub_notifications; exception when others then null; end; end $$;

create or replace function public.hub_notify(p_user uuid, p_kind text, p_title text, p_body text, p_type text, p_id uuid, p_email boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;   -- nobody is told about their own action
  if not exists (select 1 from public.hub_profiles where id = p_user and status = 'approved') then return; end if;
  insert into public.hub_notifications(user_id, kind, title, body, entity_type, entity_id, actor_name, email_status)
  values (p_user, p_kind, p_title, p_body, p_type, p_id, public.hub_my_name(), case when p_email then 'pending' end);
end $$;
revoke execute on function public.hub_notify(uuid,text,text,text,text,uuid,boolean) from anon, authenticated, public;

-- ── Rules on every task save ─────────────────────────────────────────
create or replace function public.hub_task_rules() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return new; end if;
  new.helper_ids := array(select distinct h from unnest(coalesce(new.helper_ids,'{}')) h where h is distinct from new.assignee_id);
  if tg_op = 'UPDATE' then
    -- only the main person, the one who gave the task, or an owner can close it
    if new.status = 'Done' and old.status <> 'Done'
       and not (auth.uid() = old.assignee_id or auth.uid() = old.created_by or public.hub_is_owner()
                or (old.assignee_id is null and lower(trim(coalesce(old.assignee_name,''))) = lower(trim(public.hub_my_name())))) then
      raise exception 'Only the main person, the person who gave the task, or an owner can mark it Done';
    end if;
    if new.assignee_id is distinct from old.assignee_id then new.seen_at := null; end if;
    if new.status = 'In Progress' and old.status <> 'In Progress' and new.started_at is null then new.started_at := now(); end if;
    if new.status <> 'Done' then new.done_note := case when old.status = 'Done' then null else new.done_note end; end if;
  end if;
  return new;
end $$;
drop trigger if exists hub_tasks_rules on public.hub_tasks;
create trigger hub_tasks_rules before insert or update on public.hub_tasks for each row execute function public.hub_task_rules();

-- ── Who gets told, after every task save ─────────────────────────────
create or replace function public.hub_task_notify() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare h uuid; due text; nxt date;
begin
  if auth.uid() is null then return null; end if;
  due := case when new.due_date is not null then ' · due ' || to_char(new.due_date, 'DD Mon') else '' end;
  if tg_op = 'INSERT' then
    perform public.hub_notify(new.assignee_id, 'assigned', 'New task for you: ' || new.title, new.priority || ' priority' || due, 'task', new.id, true);
    foreach h in array new.helper_ids loop
      perform public.hub_notify(h, 'helper', 'You are a helper on: ' || new.title, 'Main person: ' || coalesce(new.assignee_name,'—') || due, 'task', new.id, true);
    end loop;
    return null;
  end if;
  if new.deleted_at is not null then return null; end if;

  if new.assignee_id is distinct from old.assignee_id then
    perform public.hub_notify(new.assignee_id, 'assigned', 'Task moved to you: ' || new.title, new.priority || ' priority' || due, 'task', new.id, true);
    perform public.hub_notify(old.assignee_id, 'moved', 'Task moved to ' || coalesce(new.assignee_name,'someone else') || ': ' || new.title, null, 'task', new.id, false);
  end if;
  foreach h in array new.helper_ids loop
    if not (h = any(old.helper_ids)) then
      perform public.hub_notify(h, 'helper', 'You are a helper on: ' || new.title, 'Main person: ' || coalesce(new.assignee_name,'—') || due, 'task', new.id, true);
    end if;
  end loop;

  if new.status is distinct from old.status then
    perform public.hub_notify(new.created_by, case when new.status = 'Done' then 'done' else 'status' end,
      case when new.status = 'Done' then '✅ Done: ' else 'Now ' || new.status || ': ' end || new.title,
      coalesce(new.done_note, ''), 'task', new.id, new.status = 'Done');
    if new.assignee_id is distinct from new.created_by then
      perform public.hub_notify(new.assignee_id, 'status', 'Now ' || new.status || ': ' || new.title, null, 'task', new.id, false);
    end if;
    -- repeating task: create the next one when this one is done
    if new.status = 'Done' and new.repeat is not null and not exists (select 1 from public.hub_tasks where repeat_from = new.id) then
      nxt := coalesce(new.due_date, current_date) + case new.repeat when 'daily' then interval '1 day' when 'weekly' then interval '7 days'
               when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' else interval '1 year' end;
      insert into public.hub_tasks(title, description, assignee_id, assignee_name, helper_ids, department, priority, status, due_date, firm_id,
                                   checklist, repeat, repeat_from, created_by, created_by_name)
      values (new.title, new.description, new.assignee_id, new.assignee_name, new.helper_ids, new.department, new.priority, 'To-Do', nxt, new.firm_id,
              (select coalesce(jsonb_agg(jsonb_set(x, '{done}', 'false')), '[]') from jsonb_array_elements(new.checklist) x),
              new.repeat, new.id, new.created_by, new.created_by_name);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists hub_tasks_notify on public.hub_tasks;
create trigger hub_tasks_notify after insert or update on public.hub_tasks for each row execute function public.hub_task_notify();

-- the repeat insert runs with auth.uid() set, so stamp would overwrite created_by — keep the original giver
create or replace function public.hub_task_keep_giver() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare o record;
begin
  if new.repeat_from is not null then
    select created_by, created_by_name into o from public.hub_tasks where id = new.repeat_from;
    if o.created_by is not null then new.created_by := o.created_by; new.created_by_name := o.created_by_name; end if;
  end if;
  return new;
end $$;
drop trigger if exists hub_tasks_zz_keep_giver on public.hub_tasks;
create trigger hub_tasks_zz_keep_giver before insert on public.hub_tasks for each row execute function public.hub_task_keep_giver();

-- comments on a task → bell to everyone on it
create or replace function public.hub_task_comment_notify() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare t record; u uuid;
begin
  if new.entity_type <> 'task' then return null; end if;
  select * into t from public.hub_tasks where id = new.entity_id;
  if t.id is null then return null; end if;
  for u in select distinct x from unnest(array[t.assignee_id, t.created_by] || t.helper_ids) x where x is not null loop
    perform public.hub_notify(u, 'comment', '💬 ' || coalesce(new.author_name,'Someone') || ' commented on: ' || t.title, left(new.body, 140), 'task', t.id, false);
  end loop;
  return null;
end $$;
drop trigger if exists hub_comments_task_notify on public.hub_comments;
create trigger hub_comments_task_notify after insert on public.hub_comments for each row execute function public.hub_task_comment_notify();

-- "Seen" tick: set when the main person opens the task
create or replace function public.hub_task_seen(p_id uuid) returns void
language sql security definer set search_path to 'public' as $$
  update public.hub_tasks set seen_at = now() where id = p_id and assignee_id = auth.uid() and seen_at is null;
$$;
revoke execute on function public.hub_task_seen(uuid) from anon, public;
grant execute on function public.hub_task_seen(uuid) to authenticated;

-- ── Email queue (every minute) ───────────────────────────────────────
create or replace function public.hub_notify_send_emails() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n record; t record; sent int := 0; st int; body text; col text;
begin
  if coalesce((select v from public.hub_cmp_settings where k='email_enabled'),'false') <> 'true' then
    update public.hub_notifications set email_status = 'off' where email_status = 'pending'; return 0;
  end if;
  for n in select x.*, p.email, p.full_name from public.hub_notifications x join public.hub_profiles p on p.id = x.user_id
            where x.email_status = 'pending' order by x.created_at limit 20 for update of x skip locked loop
    select * into t from public.hub_tasks where id = n.entity_id;
    col := case n.kind when 'done' then '#16a34a' when 'helper' then '#7c3aed' else '#1d4ed8' end;
    body := '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937">'
      || '<div style="background:' || col || ';color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-size:17px;font-weight:bold">' || n.title || '</div>'
      || '<div style="border:1px solid #e5e7eb;border-top:none;padding:16px 18px;border-radius:0 0 10px 10px;font-size:14px">'
      || '<p style="margin:0 0 10px">Dear ' || coalesce(n.full_name,'') || ',</p>'
      || case when t.id is not null then
           '<table style="font-size:14px;border-collapse:collapse">'
           || '<tr><td style="color:#6b7280;padding:3px 12px 3px 0">Task</td><td><b>' || t.title || '</b></td></tr>'
           || case when coalesce(t.description,'') <> '' then '<tr><td style="color:#6b7280;padding:3px 12px 3px 0;vertical-align:top">Details</td><td>' || left(t.description, 600) || '</td></tr>' else '' end
           || '<tr><td style="color:#6b7280;padding:3px 12px 3px 0">Main person</td><td>' || coalesce(t.assignee_name,'—') || '</td></tr>'
           || '<tr><td style="color:#6b7280;padding:3px 12px 3px 0">Priority</td><td>' || t.priority || '</td></tr>'
           || '<tr><td style="color:#6b7280;padding:3px 12px 3px 0">Due</td><td>' || coalesce(to_char(t.due_date,'DD Mon YYYY'),'No date') || '</td></tr>'
           || '<tr><td style="color:#6b7280;padding:3px 12px 3px 0">Given by</td><td>' || coalesce(t.created_by_name,'—') || '</td></tr>'
           || case when n.kind = 'done' and coalesce(t.done_note,'') <> '' then '<tr><td style="color:#6b7280;padding:3px 12px 3px 0">Note</td><td>' || t.done_note || '</td></tr>' else '' end
           || '</table>' else coalesce('<p>' || n.body || '</p>','') end
      || '<p style="margin:16px 0 0"><a href="https://hub.velite.in/#tasks/' || coalesce(n.entity_id::text,'') || '" style="background:#1d4ed8;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">Open in Velite Hub</a></p>'
      || '<p style="font-size:11px;color:#9ca3af;margin-top:14px">Sent by Velite Hub because of an action by ' || coalesce(n.actor_name,'a team member') || '.</p></div></div>';
    st := public.hub_cmp_mail_send(n.email, n.title, body, 1, 'task');
    update public.hub_notifications set email_status = st::text, email_sent_at = now() where id = n.id;
    sent := sent + 1;
  end loop;
  return sent;
end $$;
revoke execute on function public.hub_notify_send_emails() from anon, authenticated, public;

-- ── Daily (07:55 IST): due tomorrow, overdue, auto-escalation ────────
create or replace function public.hub_task_daily() returns int
language plpgsql security definer set search_path to 'public' as $$
declare t record; o record; n int := 0;
begin
  for t in select * from public.hub_tasks where deleted_at is null and status <> 'Done' and due_date is not null loop
    if t.due_date = current_date + 1 then
      insert into public.hub_notifications(user_id, kind, title, body, entity_type, entity_id, actor_name)
      select t.assignee_id, 'due', '⏰ Due tomorrow: ' || t.title, null, 'task', t.id, 'Velite Hub' where t.assignee_id is not null; n := n + 1;
    elsif t.due_date = current_date - 1 then   -- first day late: person + owners
      insert into public.hub_notifications(user_id, kind, title, body, entity_type, entity_id, actor_name)
      select u, 'overdue', '🔴 Overdue: ' || t.title, 'Main person: ' || coalesce(t.assignee_name,'—'), 'task', t.id, 'Velite Hub'
        from (select t.assignee_id u union select id from public.hub_profiles where role = 'owner' and status = 'approved') x where u is not null;
      n := n + 1;
    elsif t.due_date = current_date - 3 and t.priority <> 'High' and t.escalated_at is null then
      update public.hub_tasks set priority = 'High', escalated_at = now() where id = t.id;
      insert into public.hub_notifications(user_id, kind, title, body, entity_type, entity_id, actor_name)
      select t.assignee_id, 'escalated', '⬆️ Now HIGH priority (3 days late): ' || t.title, null, 'task', t.id, 'Velite Hub' where t.assignee_id is not null; n := n + 1;
    end if;
  end loop;
  delete from public.hub_notifications where read_at is not null and created_at < now() - interval '60 days';
  return n;
end $$;
revoke execute on function public.hub_task_daily() from anon, authenticated, public;

-- ── Morning email part for tasks (used by the 08:00 email) ───────────
create or replace function public.hub_task_digest_html(p_user uuid, p_owner boolean) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare h text := ''; r record; rows text := ''; cnt int := 0; team text := '';
begin
  for r in select title, due_date, priority, (due_date - current_date) d, status from public.hub_tasks
            where deleted_at is null and status <> 'Done' and assignee_id = p_user and due_date is not null and due_date <= current_date + 2
            order by due_date, priority loop
    cnt := cnt + 1;
    rows := rows || '<tr><td style="padding:7px 6px;border-bottom:1px solid #f1f5f9;white-space:nowrap"><span style="background:'
      || case when r.d < 0 then '#dc2626' when r.d = 0 then '#ea580c' else '#d97706' end
      || ';color:#fff;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:bold">'
      || case when r.d < 0 then (-r.d) || ' DAY' || case when r.d = -1 then '' else 'S' end || ' LATE' when r.d = 0 then 'TODAY' when r.d = 1 then 'TOMORROW' else 'in 2 days' end
      || '</span></td><td style="padding:7px 6px;border-bottom:1px solid #f1f5f9"><b>' || r.title || '</b> <span style="color:#6b7280;font-size:12px">· ' || r.priority || ' · ' || r.status || '</span></td></tr>';
  end loop;
  if cnt > 0 then
    h := '<div style="font-weight:bold;font-size:15px;margin:4px 0 6px">✅ Your tasks needing attention</div><table style="width:100%;border-collapse:collapse;font-size:13px">' || rows || '</table>';
  end if;
  -- owners on Monday: team summary
  if p_owner and extract(isodow from current_date) = 1 then
    for r in select coalesce(assignee_name,'No one') who, count(*) open,
                    count(*) filter (where due_date < current_date) late,
                    count(*) filter (where due_date between current_date and current_date + 6) wk,
                    (select count(*) from public.hub_tasks d where d.deleted_at is null and d.status = 'Done' and d.assignee_id is not distinct from t.assignee_id and d.completed_at > now() - interval '7 days') done7
               from public.hub_tasks t where deleted_at is null and status <> 'Done' group by assignee_id, assignee_name order by 3 desc, 2 desc loop
      team := team || '<tr><td style="padding:6px;border-bottom:1px solid #f1f5f9"><b>' || r.who || '</b></td><td style="padding:6px;border-bottom:1px solid #f1f5f9;text-align:center">' || r.open
        || '</td><td style="padding:6px;border-bottom:1px solid #f1f5f9;text-align:center;color:' || case when r.late > 0 then '#dc2626;font-weight:bold' else '#6b7280' end || '">' || r.late
        || '</td><td style="padding:6px;border-bottom:1px solid #f1f5f9;text-align:center">' || r.wk || '</td><td style="padding:6px;border-bottom:1px solid #f1f5f9;text-align:center;color:#16a34a">' || r.done7 || '</td></tr>';
    end loop;
    if team <> '' then
      h := h || '<div style="font-weight:bold;font-size:15px;margin:16px 0 6px">👥 Team this week</div><table style="width:100%;border-collapse:collapse;font-size:13px">'
        || '<tr style="color:#6b7280;font-size:12px"><td style="padding:4px 6px">Person</td><td style="text-align:center">Open</td><td style="text-align:center">Late</td><td style="text-align:center">Due this week</td><td style="text-align:center">Done last 7 days</td></tr>' || team || '</table>';
    end if;
  end if;
  return nullif(h, '');
end $$;
revoke execute on function public.hub_task_digest_html(uuid, boolean) from anon, authenticated, public;

-- ── Jobs ─────────────────────────────────────────────────────────────
select cron.unschedule(jobname) from cron.job where jobname in ('hub-task-emails','hub-task-daily');
select cron.schedule('hub-task-emails', '* * * * *', $c$select public.hub_notify_send_emails()$c$);
select cron.schedule('hub-task-daily', '25 2 * * *', $c$select public.hub_task_daily()$c$);

-- ── 08:00 email = tasks + compliance in one ──────────────────────────
create or replace function public.hub_cmp_send_reminders(p_only uuid default null, p_force boolean default false)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare p record; rows jsonb; cnt int; sent int := 0; late int; today_n int; subj text; weekly boolean := extract(isodow from current_date) = 1;
  golive date := coalesce((select v from public.hub_cmp_settings where k='go_live')::date, current_date);
  t_html text; t_late int; t_today int; html text;
begin
  if auth.uid() is not null and not public.hub_is_owner() then raise exception 'Only an owner can send reminders'; end if;
  if p_only is null and coalesce((select v from public.hub_cmp_settings where k='email_enabled'),'false') <> 'true' then return 0; end if;
  for p in select * from public.hub_profiles where status = 'approved' and coalesce(email,'') <> '' and (p_only is null or id = p_only) loop
    with base as (
      select i.*, l.title, l.dept, l.form, l.portal, l.penalty, l.lead, (i.due_date - current_date) as days,
             (select full_name from public.hub_profiles x where x.id = i.owner_id) as who
        from public.hub_cmp_items i join public.hub_cmp_library l using (code)
       where i.deleted_at is null and i.due_date >= golive
    ), mine as (
      select * from base b where
        ( b.status in ('pending','in_progress') and (b.owner_id = p.id or b.checker_id = p.id)
          and (p_force and b.days <= 14 or public.hub_cmp_remind_today(b.due_date, b.lead)) )
        or ( b.status = 'filed' and b.checker_id = p.id and (p_force or b.filed_at::date <= current_date - 1) )
        or ( p.role = 'owner' and b.status in ('pending','in_progress') and (
               (b.days < 0 and public.hub_cmp_remind_today(b.due_date, b.lead))
            or (b.owner_id is null and b.days between 0 and 3)
            or ((weekly or p_force) and b.days between 0 and 14) ) )
    )
    select coalesce(jsonb_agg(jsonb_build_object('firm',firm_id,'title',title,'period',period_label,'dept',dept,'form',form,'portal',portal,
             'penalty',penalty,'due',due_date,'days',days,'status',status,'who',who) order by due_date, firm_id), '[]'::jsonb), count(*),
           count(*) filter (where days < 0 and status <> 'filed'), count(*) filter (where days = 0 and status <> 'filed')
      into rows, cnt, late, today_n from mine;
    t_html := public.hub_task_digest_html(p.id, p.role = 'owner');
    select count(*) filter (where due_date < current_date), count(*) filter (where due_date = current_date) into t_late, t_today
      from public.hub_tasks where deleted_at is null and status <> 'Done' and assignee_id = p.id;
    continue when cnt = 0 and t_html is null;
    html := public.hub_cmp_mail_html(p.full_name,
      case when cnt = 0 then 'No compliance items need you today.'
           when weekly and p.role = 'owner' then 'Here is the compliance picture for the next two weeks, plus anything overdue or waiting for you.'
           else 'These compliance items need your attention:' end, rows);
    html := replace(html, '🛡️ Velite Compliance', '☀️ Velite Hub — your morning list');
    if t_html is not null then
      html := regexp_replace(html, '(<p style="margin:0 0 14px">)', t_html || '<div style="font-weight:bold;font-size:15px;margin:18px 0 6px">🛡️ Compliance</div>\1');
    end if;
    subj := '☀️ Velite Hub: ' || case when late + t_late > 0 then (late + t_late) || ' overdue · ' else '' end
         || case when today_n + t_today > 0 then (today_n + t_today) || ' due today · ' else '' end
         || 'your list for ' || to_char(current_date, 'DD Mon');
    perform public.hub_cmp_mail_send(p.email, subj, html, cnt, case when p_only is not null then 'test' else 'daily' end);
    sent := sent + 1;
  end loop;
  return sent;
end $function$;
