import { createClient } from "@supabase/supabase-js";

// Public (browser) keys. Security comes from the database's row-level rules,
// not from hiding these values.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://ynoxxwkcuchvstsfxtqw.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || "sb_publishable_vElFb-RhJ96Yf4uqR5KoaQ_To-qkb2Z";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "velite-hub-auth" },
});
