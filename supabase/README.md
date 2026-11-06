# Velite Hub — database notes

Velite Hub lives in the Supabase project **velite-compliance-studio** (`ynoxxwkcuchvstsfxtqw`, Mumbai),
in its own `hub_*` tables. The full SQL of every change is stored in Supabase's migration history
(Dashboard → Database → Migrations). Applied on 6 Nov 2026:

| Migration | What it does |
| --- | --- |
| `hub_enable_http` | Enables the `http` extension (used to copy data from the old Firebase app) |
| `hub_firebase_snapshot` | Safety copy of the whole old Firebase database in `hub_firebase_snapshot` |
| `studio_restrict_to_studio_members` | Compliance Studio: "any signed-in user" rules now require a Studio profile. Hub sign-ups get no Studio profile. |
| `hub_core_schema` | Hub tables, server-side stamping (who/when), activity log, approval flow, owner functions, row-level security, realtime |
| `hub_firebase_import_fn` | `hub_import_firebase(true)` — re-runnable copy from Firebase (skips rows already copied) |
| `hub_tighten_function_grants` | Removes public access to internal functions |
| `hub_bin_auto_cleanup` | Daily job (02:00 IST) that empties recycle-bin items older than 30 days |

## Final data sync before switching off Firebase
Run once in the SQL editor: `select public.hub_import_firebase(true);`
It takes a fresh snapshot and copies only items added since the first copy.

## Access model
- `hub_profiles.status`: `pending` → `approved` (by an owner) or `disabled`.
- `role`: `owner` (everything, incl. Business Compass and Admin), `manager`, `member`.
- Every table checks `hub_is_approved()` / `hub_is_owner()` in the database itself.
- `created_by_name`, `created_at`, `completed_*`, `ordered_*`, `received_*`, `deleted_*` are set by the
  server and cannot be faked or backdated from the browser.

## Undo for the Compliance Studio change (only if ever needed)
See `rollback_studio_policies.sql`.
