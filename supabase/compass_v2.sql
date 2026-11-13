-- Business Compass v2 (Nov 2026): Vision → yearly Goals → Milestones → Tasks, check-ins.
-- Company goals: owners only. Personal goals: only the person who made them (and their tasks are private).

alter table public.hub_goals
  add column if not exists scope text not null default 'company' check (scope in ('company','personal')),
  add column if not exists level text not null default 'goal' check (level in ('vision','goal')),
  add column if not exists parent_id uuid references public.hub_goals(id) on delete set null,
  add column if not exists firm_id text,
  add column if not exists owner_id uuid references public.hub_profiles(id) on delete set null,
  add column if not exists fy text,
  add column if not exists category text,
  add column if not exists measure text not null default 'tasks' check (measure in ('tasks','number','manual')),
  add column if not exists unit text,
  add column if not exists start_value numeric,
  add column if not exists target_value numeric,
  add column if not exists current_value numeric,
  add column if not exists manual_pct int,
  add column if not exists status text check (status in ('on_track','at_risk','off_track')),
  add column if not exists carried_from uuid,
  add column if not exists sort int default 0;

alter table public.hub_goal_items
  add column if not exists owner_id uuid references public.hub_profiles(id) on delete set null,
  add column if not exists sort int default 0,
  add column if not exists done_at timestamptz;

create table if not exists public.hub_goal_checkins (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.hub_goals(id) on delete cascade,
  status text not null check (status in ('on_track','at_risk','off_track')),
  note text, value numeric,
  by_id uuid default auth.uid(), by_name text, at timestamptz not null default now());

alter table public.hub_tasks
  add column if not exists goal_id uuid references public.hub_goals(id) on delete set null,
  add column if not exists milestone_id uuid references public.hub_goal_items(id) on delete set null,
  add column if not exists private boolean not null default false;

-- ── Who can see what ─────────────────────────────────────────────────
create or replace function public.hub_goal_visible(g public.hub_goals) returns boolean
language sql stable set search_path to 'public' as $$
  select public.hub_is_owner() and (g.scope = 'company' or g.created_by = auth.uid()) $$;

drop policy if exists hub_goals_all on public.hub_goals;
drop policy if exists hub_goals_rw on public.hub_goals;
create policy hub_goals_rw on public.hub_goals for all to authenticated
  using (public.hub_is_owner() and (scope = 'company' or created_by = auth.uid()))
  with check (public.hub_is_owner() and (scope = 'company' or created_by = auth.uid()));

drop policy if exists hub_goal_items_all on public.hub_goal_items;
drop policy if exists hub_goal_items_rw on public.hub_goal_items;
create policy hub_goal_items_rw on public.hub_goal_items for all to authenticated
  using (exists (select 1 from public.hub_goals g where g.id = goal_id))
  with check (exists (select 1 from public.hub_goals g where g.id = goal_id));

alter table public.hub_goal_checkins enable row level security;
drop policy if exists hub_goal_checkins_rw on public.hub_goal_checkins;
create policy hub_goal_checkins_rw on public.hub_goal_checkins for all to authenticated
  using (exists (select 1 from public.hub_goals g where g.id = goal_id))
  with check (exists (select 1 from public.hub_goals g where g.id = goal_id));

-- private tasks (from personal goals): only the person who made it / the person it is for
drop policy if exists hub_tasks_read on public.hub_tasks;
create policy hub_tasks_read on public.hub_tasks for select to authenticated
  using (public.hub_is_approved() and (not private or created_by = auth.uid() or assignee_id = auth.uid()));
drop policy if exists hub_tasks_edit on public.hub_tasks;
create policy hub_tasks_edit on public.hub_tasks for update to authenticated
  using (public.hub_is_approved() and (not private or created_by = auth.uid() or assignee_id = auth.uid()))
  with check (public.hub_is_approved());

-- comments follow the thing they are on
drop policy if exists hub_comments_read on public.hub_comments;
create policy hub_comments_read on public.hub_comments for select to authenticated using (
  public.hub_is_approved() and case entity_type
    when 'goal' then exists (select 1 from public.hub_goals g where g.id = entity_id)
    when 'task' then exists (select 1 from public.hub_tasks t where t.id = entity_id)
    else true end);
drop policy if exists hub_comments_add on public.hub_comments;
create policy hub_comments_add on public.hub_comments for insert to authenticated with check (
  public.hub_is_approved() and case entity_type
    when 'goal' then exists (select 1 from public.hub_goals g where g.id = entity_id)
    when 'task' then exists (select 1 from public.hub_tasks t where t.id = entity_id)
    else true end);

-- ── Stamps and rules ─────────────────────────────────────────────────
create or replace function public.hub_goal_rules() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.scope = 'personal' then new.owner_id := coalesce(new.created_by, auth.uid()); end if;
  if tg_op = 'UPDATE' then new.scope := old.scope; end if;   -- a goal cannot switch between company and personal
  if new.level = 'vision' then new.parent_id := null; end if;
  return new;
end $$;
drop trigger if exists hub_goals_zz_rules on public.hub_goals;
create trigger hub_goals_zz_rules before insert or update on public.hub_goals for each row execute function public.hub_goal_rules();

create or replace function public.hub_goal_item_stamp2() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then new.done_at := now();
  elsif not new.done then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists hub_goal_items_zz_done on public.hub_goal_items;
create trigger hub_goal_items_zz_done before insert or update on public.hub_goal_items for each row execute function public.hub_goal_item_stamp2();

create or replace function public.hub_checkin_stamp() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  new.by_id := auth.uid(); new.by_name := public.hub_my_name(); new.at := now();
  update public.hub_goals set status = new.status,
         current_value = case when new.value is not null then new.value else current_value end
   where id = new.goal_id;
  return new;
end $$;
drop trigger if exists hub_goal_checkins_stamp on public.hub_goal_checkins;
create trigger hub_goal_checkins_stamp before insert on public.hub_goal_checkins for each row execute function public.hub_checkin_stamp();

-- tasks made from a personal goal are private and stay with that person
create or replace function public.hub_task_goal_rules() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare g record;
begin
  if new.goal_id is not null then
    select scope, created_by into g from public.hub_goals where id = new.goal_id;
    if g.scope = 'personal' then
      new.private := true;
      new.assignee_id := g.created_by;
      new.assignee_name := coalesce((select full_name from public.hub_profiles where id = g.created_by), new.assignee_name);
      new.helper_ids := '{}';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists hub_tasks_aa_goal on public.hub_tasks;
create trigger hub_tasks_aa_goal before insert or update of goal_id, assignee_id, helper_ids, private on public.hub_tasks for each row execute function public.hub_task_goal_rules();

-- activity log: never record personal goals or private tasks (other owners can read the log)
do $$ declare d text; begin
  d := pg_get_functiondef('public.hub_log()'::regprocedure);
  if position('hub_private_skip' in d) = 0 then
    d := replace(d, 'begin
  if auth.uid() is null then return null; end if;',
    'begin
  if auth.uid() is null then return null; end if;
  -- hub_private_skip
  if tg_table_name = ''hub_goals'' and coalesce(to_jsonb(coalesce(new, old))->>''scope'','''') = ''personal'' then return null; end if;
  if tg_table_name = ''hub_tasks'' and coalesce((to_jsonb(coalesce(new, old))->>''private'')::boolean, false) then return null; end if;');
    execute d;
  end if;
end $$;

-- monthly check-in reminder (1st, 08:10 IST): goal owners
create or replace function public.hub_goal_monthly() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  insert into public.hub_notifications(user_id, kind, title, body, entity_type, entity_id, actor_name)
  select coalesce(g.owner_id, g.created_by), 'goal', '🧭 Monthly check-in: ' || g.title, 'On track, at risk or off track? Add one line.', 'goal', g.id, 'Velite Hub'
    from public.hub_goals g
   where g.deleted_at is null and g.level = 'goal' and not g.achieved and coalesce(g.owner_id, g.created_by) is not null
     and not exists (select 1 from public.hub_goal_checkins c where c.goal_id = g.id and c.at > date_trunc('month', now()));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.hub_goal_monthly() from anon, authenticated, public;
select cron.unschedule(jobname) from cron.job where jobname = 'hub-goal-monthly';
select cron.schedule('hub-goal-monthly', '40 2 1 * *', $c$select public.hub_goal_monthly()$c$);

do $$ begin
  begin alter publication supabase_realtime add table public.hub_goal_checkins; exception when others then null; end;
end $$;
