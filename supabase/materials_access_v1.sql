-- Materials access (23 Nov 2026): a member sees and works on only the list(s) an owner has ticked in Admin
-- (rm = Raw materials, pm = Packing materials). Owners and managers see both. Everyone else sees no materials.
-- Members with a right can see, add and edit items of their list (including ordered / received); only owners delete.
alter table public.hub_profiles add column if not exists material_lists text[] not null default '{}';
update public.hub_profiles set material_lists = '{rm}' where id = 'ebd96f05-4616-49a2-8af0-5ccb150f82a1'; -- Shiwani Yadav
update public.hub_profiles set material_lists = '{pm}' where id = 'b883e54d-b685-4603-83f1-9c87d44f58de';  -- Digvijay

create or replace function public.hub_can_materials(p_list text) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.hub_profiles where id = auth.uid() and status = 'approved'
                 and (role in ('owner','manager') or (p_list is not null and p_list = any(material_lists))));
$$;
create or replace function public.hub_has_materials() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.hub_profiles where id = auth.uid() and status = 'approved'
                 and (role in ('owner','manager') or coalesce(array_length(material_lists,1),0) > 0));
$$;
create or replace function public.hub_admin_set_materials(p_user uuid, p_lists text[]) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.hub_is_owner() then raise exception 'Only owners can change this'; end if;
  if exists (select 1 from unnest(coalesce(p_lists,'{}')) x where x not in ('rm','pm')) then raise exception 'Unknown list'; end if;
  update public.hub_profiles set material_lists = coalesce(p_lists,'{}') where id = p_user;
end $$;

drop policy if exists hub_materials_read on public.hub_materials;
create policy hub_materials_read on public.hub_materials for select to authenticated using (public.hub_can_materials(list_type));
drop policy if exists hub_materials_add on public.hub_materials;
create policy hub_materials_add on public.hub_materials for insert to authenticated with check (public.hub_can_materials(list_type));
drop policy if exists hub_materials_edit on public.hub_materials;
create policy hub_materials_edit on public.hub_materials for update to authenticated using (public.hub_can_materials(list_type))
  with check (public.hub_can_materials(list_type) and (deleted_at is null or public.hub_can_edit_ipr()));

-- Purchase item catalogue (used to link a requirement to purchase.velite.in)
drop policy if exists hub_pv_items_read on public.hub_pv_items;
create policy hub_pv_items_read on public.hub_pv_items for select to authenticated using (public.hub_has_materials());

-- Comments follow what the person can see
drop policy if exists hub_comments_read on public.hub_comments;
create policy hub_comments_read on public.hub_comments for select to authenticated using (public.hub_is_approved() and
  case entity_type
    when 'goal' then exists (select 1 from public.hub_goals g where g.id = hub_comments.entity_id)
    when 'task' then exists (select 1 from public.hub_tasks t where t.id = hub_comments.entity_id)
    when 'compliance' then exists (select 1 from public.hub_cmp_items i where i.id = hub_comments.entity_id)
    when 'material' then exists (select 1 from public.hub_materials m where m.id = hub_comments.entity_id)
    else true end);
drop policy if exists hub_comments_add on public.hub_comments;
create policy hub_comments_add on public.hub_comments for insert to authenticated with check (public.hub_is_approved() and
  case entity_type
    when 'goal' then exists (select 1 from public.hub_goals g where g.id = hub_comments.entity_id)
    when 'task' then exists (select 1 from public.hub_tasks t where t.id = hub_comments.entity_id)
    when 'compliance' then exists (select 1 from public.hub_cmp_items i where i.id = hub_comments.entity_id)
    when 'material' then exists (select 1 from public.hub_materials m where m.id = hub_comments.entity_id)
    else true end);

-- Activity log: it holds titles of tasks, materials, trademarks and IPR items, so it follows the same visibility
-- (found while checking: members could read every task / material / trademark title here)
drop policy if exists hub_activity_read on public.hub_activity;
create policy hub_activity_read on public.hub_activity for select to authenticated using (public.hub_is_approved() and (
  public.hub_is_owner()
  or (public.hub_can_edit_ipr() and entity_type <> 'goal')
  or (entity_type = 'task' and exists (select 1 from public.hub_tasks t where t.id = hub_activity.entity_id))
  or (entity_type = 'material' and exists (select 1 from public.hub_materials m where m.id = hub_activity.entity_id))));

-- Late / needed-by alerts also go to the members who have the right to that list
create or replace function public.hub_mat_daily() returns integer language plpgsql security definer set search_path to 'public' as $function$
declare m record; n int := 0;
begin
  for m in select * from public.hub_materials where deleted_at is null and status = 'pending' and required_by is not null
             and required_by <= current_date + 2 and due_alerted_at is null loop
    insert into public.hub_notifications(user_id, kind, title, body, entity_type, entity_id, actor_name)
    select id, 'material', '⏰ Needed by ' || to_char(m.required_by,'DD Mon') || ', no PO yet: ' || m.name, coalesce(m.qty || ' ' || m.unit, ''), 'material', m.id, 'Velite Hub'
      from public.hub_profiles where status = 'approved' and (role = 'owner' or m.list_type = any(material_lists));
    update public.hub_materials set due_alerted_at = now() where id = m.id; n := n + 1;
  end loop;
  for m in select * from public.hub_materials where deleted_at is null and status = 'ordered' and late_alerted_at is null
             and (po_info->>'exp')::date < current_date loop
    insert into public.hub_notifications(user_id, kind, title, body, entity_type, entity_id, actor_name)
    select u, 'material', '🔴 Delivery late: ' || m.name, 'PO ' || coalesce(m.po_number,'') || ' · ' || coalesce(m.supplier,'') || ' · expected ' || to_char((m.po_info->>'exp')::date,'DD Mon'), 'material', m.id, 'Velite Hub'
      from (select m.created_by u union select id from public.hub_profiles where status = 'approved' and (role = 'owner' or m.list_type = any(material_lists))) x where u is not null;
    update public.hub_materials set late_alerted_at = now() where id = m.id; n := n + 1;
  end loop;
  return n;
end $function$;

-- ROLLBACK to the old behaviour (every approved member sees and edits all materials):
--   drop policy hub_materials_read on public.hub_materials; create policy hub_materials_read on public.hub_materials for select to authenticated using (public.hub_is_approved());
--   drop policy hub_materials_add on public.hub_materials;  create policy hub_materials_add on public.hub_materials for insert to authenticated with check (public.hub_is_approved());
--   drop policy hub_materials_edit on public.hub_materials; create policy hub_materials_edit on public.hub_materials for update to authenticated using (public.hub_is_approved()) with check (public.hub_is_approved());
--   drop policy hub_pv_items_read on public.hub_pv_items;   create policy hub_pv_items_read on public.hub_pv_items for select to authenticated using (public.hub_is_approved());
--   drop policy hub_activity_read on public.hub_activity;   create policy hub_activity_read on public.hub_activity for select to authenticated using (public.hub_is_approved() and ((entity_type <> 'goal') or public.hub_is_owner()));
--   (comments: drop the 'material' branch from hub_comments_read / hub_comments_add)
