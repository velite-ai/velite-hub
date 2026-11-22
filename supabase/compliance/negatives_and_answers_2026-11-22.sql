-- Reword two questions that were phrased as negatives, so "Yes" is the good answer.
update public.hub_chk_points set q='Are all receipts of ₹2 lakh or more taken by bank or another non-cash mode?', updated_at=now() where code='IT12';
update public.hub_chk_points set q='Are all production workers 18 years or older?', updated_at=now() where code='LB23';
-- Answers entered from the notes on split questions (done as data, no schema change):
--  Velite Healthcare CM05 'No' (RM Testing) + its action moved to CM14.
--  Velite Pharmaceuticals NP04 'No' (product data not up to date) + its action moved to NP10; NP04 set to Yes (registered).
--  Velite Pharmaceuticals PL13 'No' added from the 19 Nov note on PL03, with an action due 19 Dec 2026.
