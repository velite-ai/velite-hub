-- Batch Detail: the shelf life in months typed for a batch (expiry month is worked out from it)
alter table public.hub_batches add column if not exists shelf_months int;
