import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";

// Loads a whole table (our tables are small) and keeps it live:
// any change by anyone triggers a quiet reload.
export function useTable(table, { enabled = true, order = "created_at", ascending = false, columns = "*" } = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const all = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await supabase.from(table).select(columns)
        .order(order, { ascending }).range(from, from + page - 1);
      if (error) { setError(error.message); setLoading(false); return; }
      all.push(...data);
      if (data.length < page) break;
    }
    setRows(all); setError(null); setLoading(false);
  }, [table, enabled, order, ascending, columns]);

  useEffect(() => {
    if (!enabled) { setRows([]); setLoading(false); return; }
    load();
    const reloadSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 250); };
    const ch = supabase.channel(`live-${table}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, reloadSoon)
      .subscribe();
    const onFocus = () => reloadSoon();
    window.addEventListener("focus", onFocus);
    const iv = setInterval(reloadSoon, 120000); // safety net every 2 min
    return () => { supabase.removeChannel(ch); window.removeEventListener("focus", onFocus); clearInterval(iv); clearTimeout(timer.current); };
  }, [table, enabled, load]);

  return { rows, loading, error, reload: load };
}

// big file columns are left out of list loads and fetched only when downloading
const TP_COLS = "id,client,brand,products,category,status,app_no,class_no,contact,undertaking_date,undertaking_name,responsibility,created_by,created_by_name,created_at,updated_at,deleted_at,deleted_by_name";
const DOC_COLS = "id,kind,name,mark,doc_type,review,product,channel,doc_date,file_name,created_by,created_by_name,created_at,updated_at,deleted_at,deleted_by_name";

const DataCtx = createContext(null);
export const useData = () => useContext(DataCtx);

export function DataProvider({ me, children }) {
  const isOwner = me.role === "owner";
  const profiles = useTable("hub_profiles", { order: "full_name", ascending: true });
  const materials = useTable("hub_materials");
  const tasks = useTable("hub_tasks");
  const comments = useTable("hub_comments", { ascending: true });
  const goals = useTable("hub_goals", { enabled: isOwner });
  const goalItems = useTable("hub_goal_items", { enabled: isOwner, ascending: true });
  const trademarks = useTable("hub_trademarks", { order: "mark", ascending: true });
  const iprNotices = useTable("hub_ipr_notifications", { order: "notice_date" });
  const iprThird = useTable("hub_ipr_third_party", { order: "client", ascending: true, columns: TP_COLS });
  const iprDocs = useTable("hub_ipr_documents", { columns: DOC_COLS });
  const iprMatters = useTable("hub_ipr_matters", { order: "due", ascending: true });
  const iprOptions = useTable("hub_ipr_options", { order: "key", ascending: true });
  const cmpItems = useTable("hub_cmp_items", { order: "due_date", ascending: true });
  const cmpLib = useTable("hub_cmp_library", { order: "sort", ascending: true });
  const cmpFirms = useTable("hub_cmp_firms", { order: "sort", ascending: true });
  const cmpAssign = useTable("hub_cmp_assign", { order: "code", ascending: true });
  const cmpLic = useTable("hub_cmp_licences", { order: "next_due", ascending: true });

  const value = { me, isOwner, profiles, materials, tasks, comments, goals, goalItems, trademarks,
    iprNotices, iprThird, iprDocs, iprMatters, iprOptions,
    cmpItems, cmpLib, cmpFirms, cmpAssign, cmpLic };
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

// Small global toast for errors / confirmations
let pushToast = () => {};
export function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => {
    pushToast = (msg, kind = "ok") => {
      const id = Math.random();
      setList((l) => [...l, { id, msg, kind }]);
      setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === "err" ? 7000 : 3000);
    };
  }, []);
  return (
    <div className="toasts">
      {list.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
    </div>
  );
}
export const toast = (msg, kind) => pushToast(msg, kind);

// Run a Supabase call; show a friendly error if it fails.
export async function run(promise, okMsg) {
  const { data, error } = await promise;
  if (error) { toast(error.message || "Something went wrong", "err"); return { ok: false, error }; }
  if (okMsg) toast(okMsg);
  return { ok: true, data };
}
