-- Task Manager: "Send reminder" button (Nov 2026).
-- An owner, or the person who gave the tasks, can remind someone about their overdue / due-today tasks.
-- One reminder per person per 4 hours. Uses the existing bell + email queue (hub_notify).
create or replace function public.hub_task_remind(p_user uuid) returns int
language plpgsql security definer set search_path to 'public' as $$
declare od int; td int; lst text;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if p_user is null then raise exception 'Choose a person'; end if;
  if not (public.hub_is_owner() or exists (
        select 1 from public.hub_tasks where created_by = auth.uid() and assignee_id = p_user and deleted_at is null and status <> 'Done')) then
    raise exception 'You can only remind people you gave tasks to';
  end if;
  if exists (select 1 from public.hub_notifications where user_id = p_user and kind = 'task_reminder' and created_at > now() - interval '4 hours') then
    raise exception 'This person was already reminded in the last 4 hours';
  end if;
  select count(*) filter (where due_date < current_date), count(*) filter (where due_date = current_date),
         array_to_string((array_agg(title order by due_date) filter (where due_date <= current_date))[1:3], '; ')
    into od, td, lst
    from public.hub_tasks where assignee_id = p_user and deleted_at is null and status <> 'Done' and due_date is not null;
  if coalesce(od, 0) + coalesce(td, 0) = 0 then raise exception 'Nothing is overdue or due today for this person'; end if;
  perform public.hub_notify(p_user, 'task_reminder', 'Reminder: ' || od || ' overdue, ' || td || ' due today', lst, null, null, true);
  return od + td;
end $$;
revoke execute on function public.hub_task_remind(uuid) from anon, public;
grant execute on function public.hub_task_remind(uuid) to authenticated;
