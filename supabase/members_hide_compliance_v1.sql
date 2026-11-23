-- Step 1: Compliance and Trademarks are for owners (and managers) only. Members see only the compliance items assigned to them
-- (as maker or checker) with their dates, plus the library entry (title) of those items. Comments follow the same rule.
-- hub_can_edit_ipr() = approved owner or manager.

-- Trademarks and IPR: owners / managers only
drop policy if exists hub_trademarks_read on public.hub_trademarks;            create policy hub_trademarks_read on public.hub_trademarks for select to authenticated using (public.hub_can_edit_ipr());
drop policy if exists hub_ipr_documents_read on public.hub_ipr_documents;      create policy hub_ipr_documents_read on public.hub_ipr_documents for select to authenticated using (public.hub_can_edit_ipr());
drop policy if exists hub_ipr_matters_read on public.hub_ipr_matters;          create policy hub_ipr_matters_read on public.hub_ipr_matters for select to authenticated using (public.hub_can_edit_ipr());
drop policy if exists hub_ipr_notifications_read on public.hub_ipr_notifications; create policy hub_ipr_notifications_read on public.hub_ipr_notifications for select to authenticated using (public.hub_can_edit_ipr());
drop policy if exists hub_ipr_options_read on public.hub_ipr_options;          create policy hub_ipr_options_read on public.hub_ipr_options for select to authenticated using (public.hub_can_edit_ipr());
drop policy if exists hub_ipr_third_party_read on public.hub_ipr_third_party;  create policy hub_ipr_third_party_read on public.hub_ipr_third_party for select to authenticated using (public.hub_can_edit_ipr());

-- Compliance register, papers, checklists: owners / managers only
drop policy if exists hub_cmp_licences_read on public.hub_cmp_licences;  create policy hub_cmp_licences_read on public.hub_cmp_licences for select to authenticated using (public.hub_can_edit_ipr());
drop policy if exists hub_cmp_licences_ins on public.hub_cmp_licences;   create policy hub_cmp_licences_ins on public.hub_cmp_licences for insert to authenticated with check (public.hub_can_edit_ipr());
drop policy if exists hub_cmp_licences_upd on public.hub_cmp_licences;   create policy hub_cmp_licences_upd on public.hub_cmp_licences for update to authenticated using (public.hub_can_edit_ipr()) with check (public.hub_can_edit_ipr());
drop policy if exists hub_cmp_docs_read on public.hub_cmp_docs;          create policy hub_cmp_docs_read on public.hub_cmp_docs for select to authenticated using (public.hub_can_edit_ipr());
drop policy if exists hub_cmp_docs_ins on public.hub_cmp_docs;           create policy hub_cmp_docs_ins on public.hub_cmp_docs for insert to authenticated with check (public.hub_can_edit_ipr());
drop policy if exists hub_chk_answers_read on public.hub_chk_answers;    create policy hub_chk_answers_read on public.hub_chk_answers for select to authenticated using (public.hub_can_edit_ipr());
drop policy if exists hub_chk_heads_read on public.hub_chk_heads;        create policy hub_chk_heads_read on public.hub_chk_heads for select to authenticated using (public.hub_can_edit_ipr());
drop policy if exists hub_chk_log_read on public.hub_chk_log;            create policy hub_chk_log_read on public.hub_chk_log for select to authenticated using (public.hub_can_edit_ipr());
drop policy if exists hub_chk_points_read on public.hub_chk_points;      create policy hub_chk_points_read on public.hub_chk_points for select to authenticated using (public.hub_can_edit_ipr());
drop policy if exists hub_cmp_assign_read on public.hub_cmp_assign;      create policy hub_cmp_assign_read on public.hub_cmp_assign for select to authenticated using (public.hub_can_edit_ipr());

-- Compliance items: owners / managers see all; a member sees only items where they are the maker or the checker
drop policy if exists hub_cmp_items_read on public.hub_cmp_items;  create policy hub_cmp_items_read on public.hub_cmp_items for select to authenticated using (
  public.hub_can_edit_ipr() or (public.hub_is_approved() and (owner_id = auth.uid() or checker_id = auth.uid())));
drop policy if exists hub_cmp_items_ins on public.hub_cmp_items;   create policy hub_cmp_items_ins on public.hub_cmp_items for insert to authenticated with check (public.hub_can_edit_ipr());
drop policy if exists hub_cmp_items_upd on public.hub_cmp_items;   create policy hub_cmp_items_upd on public.hub_cmp_items for update to authenticated using (
  public.hub_can_edit_ipr() or (public.hub_is_approved() and (owner_id = auth.uid() or checker_id = auth.uid()))) with check (public.hub_is_approved());

-- Library (item titles): owners / managers see all; a member sees only the entries of items they can see
drop policy if exists hub_cmp_library_read on public.hub_cmp_library;  create policy hub_cmp_library_read on public.hub_cmp_library for select to authenticated using (
  public.hub_can_edit_ipr() or exists (select 1 from public.hub_cmp_items i where i.code = hub_cmp_library.code));

-- Comments on compliance items follow the item
drop policy if exists hub_comments_read on public.hub_comments;
create policy hub_comments_read on public.hub_comments for select to authenticated using (public.hub_is_approved() and
  case entity_type
    when 'goal' then exists (select 1 from public.hub_goals g where g.id = hub_comments.entity_id)
    when 'task' then exists (select 1 from public.hub_tasks t where t.id = hub_comments.entity_id)
    when 'compliance' then exists (select 1 from public.hub_cmp_items i where i.id = hub_comments.entity_id)
    else true end);
drop policy if exists hub_comments_add on public.hub_comments;
create policy hub_comments_add on public.hub_comments for insert to authenticated with check (public.hub_is_approved() and
  case entity_type
    when 'goal' then exists (select 1 from public.hub_goals g where g.id = hub_comments.entity_id)
    when 'task' then exists (select 1 from public.hub_tasks t where t.id = hub_comments.entity_id)
    when 'compliance' then exists (select 1 from public.hub_cmp_items i where i.id = hub_comments.entity_id)
    else true end);
