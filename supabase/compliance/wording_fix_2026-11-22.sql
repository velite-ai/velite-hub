-- Make two split questions readable on their own.
update public.hub_chk_points set q='Are loans from directors and relatives reported in DPT-3?', updated_at=now() where code='MC12';
update public.hub_chk_points set q='Are third-party manufacturing, supply and distributor agreements filed in one indexed place?', updated_at=now() where code='LG09';
