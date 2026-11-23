-- Task visibility (23 Nov 2026): members see only tasks given to them, given by them, or where they are a helper.
-- Owners see everything (Team tab, Team at a glance, Compass goal progress). Comments follow task visibility (hub_comments_read checks hub_tasks).
-- Applied as migration hub_tasks_visibility_v5. The old 'private' flag is no longer needed for this (all tasks behave as private to members).
drop policy if exists hub_tasks_read on public.hub_tasks;
create policy hub_tasks_read on public.hub_tasks for select to authenticated using (
  public.hub_is_approved() and (public.hub_is_owner() or created_by = auth.uid() or assignee_id = auth.uid() or auth.uid() = any(helper_ids)));
drop policy if exists hub_tasks_edit on public.hub_tasks;
create policy hub_tasks_edit on public.hub_tasks for update to authenticated using (
  public.hub_is_approved() and (public.hub_is_owner() or created_by = auth.uid() or assignee_id = auth.uid() or auth.uid() = any(helper_ids)))
  with check (public.hub_is_approved());
-- ROLLBACK to the old behaviour (everyone sees every non-private task):
--   drop policy hub_tasks_read on public.hub_tasks;
--   create policy hub_tasks_read on public.hub_tasks for select to authenticated using (public.hub_is_approved() and ((not private) or created_by = auth.uid() or assignee_id = auth.uid()));
--   drop policy hub_tasks_edit on public.hub_tasks;
--   create policy hub_tasks_edit on public.hub_tasks for update to authenticated using (public.hub_is_approved() and ((not private) or created_by = auth.uid() or assignee_id = auth.uid())) with check (public.hub_is_approved());
