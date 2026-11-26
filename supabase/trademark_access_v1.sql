-- Trademarks / IPR: an owner can tick members in Admin (hub_profiles.ipr_access); hub_can_edit_ipr() now allows them
alter table public.hub_profiles add column if not exists ipr_access boolean not null default false;
create or replace function public.hub_can_edit_ipr() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hub_profiles where id = auth.uid() and status = 'approved' and (role in ('owner','manager') or ipr_access)) $$;
create or replace function public.hub_admin_set_ipr(p_user uuid, p_on boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.hub_is_owner() then raise exception 'Owners only'; end if;
  update public.hub_profiles set ipr_access = p_on where id = p_user;
end $$;
revoke all on function public.hub_admin_set_ipr(uuid, boolean) from public, anon;
grant execute on function public.hub_admin_set_ipr(uuid, boolean) to authenticated;
