-- Export: letter-of-authority details of a party (authorised person, authority, trademarks, validity)
alter table public.exp_parties add column if not exists authority jsonb not null default '{}';
