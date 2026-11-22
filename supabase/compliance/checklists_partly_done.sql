-- Checklist answer "Partly done" (value 'partial'), Nov 2026. Applied as migration "hub_chk_partly_done".
-- Rules: needs a comment (what is done / what is pending), an owner (defaults to the department head) and a target date, like "No".
-- It creates the same CK01 follow-up action with reminders. It is shown in amber and is NOT counted as in order.
-- When the action is marked done with proof, the point turns to Yes on its own (hub_chk_item_done).
alter table public.hub_chk_answers drop constraint if exists hub_chk_answers_answer_check;
alter table public.hub_chk_answers add constraint hub_chk_answers_answer_check check (answer in ('yes','no','na','partial'));
-- hub_chk_answer: 'partial' is handled like 'no' for owner / due date / follow-up action, and additionally requires a note.
-- hub_chk_item_done: closing the action turns an answer of 'no' OR 'partial' to 'yes'.
-- hub_chk_scorecard_html: counts "partly done" in the sentence and treats it as work pending (amber) in the department table.
-- (These three functions were patched in place; read the live text with pg_get_functiondef if you need it.)
