import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { RM_UNITS, PM_UNITS } from "../lib/constants";
import { fmtDateTime, fmtDate, dueLabel, daysUntil, todayISO, timeAgo } from "../lib/dates";
import Comments, { commentCount } from "../components/Comments";
import { Modal, Field, Empty, SearchBox, useConfirm } from "../components/ui";
import { FIRM_COLORS } from "./compliance/common";

const FIRMS = ["VP", "VH", "VI", "VS"];
const LISTS = {
  rm: { title: "Raw Materials", icon: "🧪", color: "#1a6fa8", units: RM_UNITS, types: ["Raw Materials", "Others"] },
  pm: { title: "Packing Materials", icon: "📦", color: "#6c3483", units: PM_UNITS, types: ["Packing Materials", "Cartons & Labels", "Tubes", "Others"] },
};
const ST = { pending: { label: "Waiting for PO", c: "#d97706" }, ordered: { label: "PO raised", c: "#2563eb" }, received: { label: "Arrived", c: "#16a34a" } };
const ageDays = (ts) => Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 86400000));
const isLate = (m) => m.status === "ordered" && m.po_info?.exp && daysUntil(m.po_info.exp) < 0;
const fmtQty = (n) => (n === null || n === undefined ? "" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 3 }));
const inr = (n) => (n === null || n === undefined ? "" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

function sortOpen(a, b) {
  const la = isLate(a), lb = isLate(b);
  if (la !== lb) return la ? -1 : 1;
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  const da = a.required_by || "9999", db = b.required_by || "9999";
  if (da !== db) return da < db ? -1 : 1;
  return a.created_at < b.created_at ? -1 : 1;
}

// item info from purchase.velite.in for the linked requests (and prices for owners)
function usePv(ids, isOwner) {
  const [items, setItems] = useState({});
  const [prices, setPrices] = useState({});
  const key = [...new Set(ids)].sort().join(",");
  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (!list.length) return;
    supabase.from("hub_pv_items").select("*").in("id", list).then(({ data }) => setItems(Object.fromEntries((data || []).map((x) => [x.id, x]))));
    if (isOwner) supabase.from("hub_pv_prices").select("*").in("item_id", list).then(({ data }) => setPrices(Object.fromEntries((data || []).map((x) => [x.item_id, x]))));
  }, [key, isOwner]);
  return [items, prices];
}

export default function Materials() {
  const { materials, isOwner } = useData();
  const [list, setList] = useState(() => localStorage.getItem("hub-mat-list") || "rm");
  const [view, setView] = useState("list");
  const [stage, setStage] = useState("open");
  const [firm, setFirm] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [linking, setLinking] = useState(null);
  const [ordering, setOrdering] = useState(null);
  const [sync, setSync] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();
  const cfg = LISTS[list];

  useEffect(() => { supabase.from("hub_cmp_settings").select("v").eq("k", "pv_synced_at").maybeSingle().then(({ data }) => setSync(data?.v || null)); }, [materials.rows]);

  const all = materials.rows.filter((m) => !m.deleted_at);
  const live = all.filter((m) => m.list_type === list && (!firm || m.firm_id === firm));
  const open = live.filter((m) => m.status !== "received");
  const month = todayISO().slice(0, 7);
  const stats = {
    waiting: open.filter((m) => m.status === "pending"),
    raised: open.filter((m) => m.status === "ordered"),
    late: open.filter(isLate),
    urgent: open.filter((m) => m.urgent),
    arrived: live.filter((m) => m.status === "received" && (m.received_at || "").slice(0, 7) === month),
  };
  const oldest = stats.waiting.reduce((n, m) => Math.max(n, ageDays(m.created_at)), 0);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    let r = stage === "open" ? open : stage === "late" ? stats.late : stage === "urgent" ? stats.urgent : live.filter((m) => m.status === stage);
    if (s) r = r.filter((m) => [m.name, m.supplier, m.po_number, m.notes, m.created_by_name, m.for_product].join(" ").toLowerCase().includes(s));
    if (stage === "received") return [...r].sort((a, b) => ((a.received_at || "") < (b.received_at || "") ? 1 : -1)).slice(0, s ? 500 : 150);
    return [...r].sort(sortOpen);
  }, [live, stage, q]); // eslint-disable-line

  const [pvItems, pvPrices] = usePv(shown.filter((m) => m.pv_item_id).map((m) => m.pv_item_id), isOwner);
  const pickList = (k) => { setList(k); localStorage.setItem("hub-mat-list", k); };

  const setStatus = async (m, status, extra = {}) => {
    const r = await run(supabase.from("hub_materials").update({ status, ...extra }).eq("id", m.id),
      status === "pending" ? "Moved back to Waiting for PO" : status === "ordered" ? "Marked: PO raised" : "Marked: arrived");
    if (r.ok) materials.reload();
  };
  const del = async (m) => {
    const ok = await ask({ title: "Delete this requirement?", body: `"${m.name}" will go to the recycle bin. An owner can restore it within 30 days.`, okText: "Delete", danger: true });
    if (!ok) return;
    const r = await run(supabase.from("hub_materials").update({ deleted_at: new Date().toISOString() }).eq("id", m.id), "Moved to recycle bin");
    if (r.ok) materials.reload();
  };
  const refresh = async () => {
    setBusy(true);
    const r = await run(supabase.rpc("hub_pv_refresh"));
    setBusy(false);
    if (r.ok) { toast(r.data?.po_raised || r.data?.arrived ? `Updated: ${r.data.po_raised} PO raised, ${r.data.arrived} arrived` : "Up to date with purchase.velite.in"); materials.reload(); }
  };

  const rowProps = (m) => ({
    m, pv: pvItems[m.pv_item_id], price: pvPrices[m.pv_item_id],
    onOrder: () => setOrdering(m), onReceive: () => setStatus(m, "received"),
    onBack: () => setStatus(m, m.status === "received" ? "ordered" : "pending"),
    onEdit: () => setEditing(m), onDelete: () => del(m), onLink: () => setLinking(m),
  });
  const groups = [
    ["🔴 Delivery late", shown.filter(isLate)],
    ["🚨 Urgent", shown.filter((m) => !isLate(m) && m.urgent)],
    ["🟠 Needed within 7 days", shown.filter((m) => !isLate(m) && !m.urgent && m.required_by && daysUntil(m.required_by) <= 7)],
    ["🔵 Later / no date", shown.filter((m) => !isLate(m) && !m.urgent && !(m.required_by && daysUntil(m.required_by) <= 7))],
  ];

  return (
    <div className="section mt">
      <div className="mt-hero">
        <div>
          <div className="mt-hero-title">📦 Material Requirements</div>
          <div className="mt-hero-sub">Production asks here · Purchase raises the PO in purchase.velite.in · this page updates by itself</div>
        </div>
        <div className="mt-sync">
          <span>{sync ? `Synced ${timeAgo(sync)}` : "Not synced yet"}</span>
          <button onClick={refresh} disabled={busy}>{busy ? "Checking…" : "↻ Check purchase now"}</button>
        </div>
      </div>

      <div className="mt-kpis">
        <button className={`mt-kpi amber ${stage === "pending" ? "on" : ""}`} onClick={() => setStage("pending")}><b>{stats.waiting.length}</b><span>Waiting for PO</span>{oldest > 0 && <small>oldest {oldest} day{oldest === 1 ? "" : "s"}</small>}</button>
        <button className={`mt-kpi blue ${stage === "ordered" ? "on" : ""}`} onClick={() => setStage("ordered")}><b>{stats.raised.length}</b><span>PO raised, not arrived</span></button>
        <button className={`mt-kpi red ${stage === "late" ? "on" : ""}`} onClick={() => setStage("late")}><b>{stats.late.length}</b><span>Delivery late</span></button>
        <button className={`mt-kpi rose ${stage === "urgent" ? "on" : ""}`} onClick={() => setStage("urgent")}><b>{stats.urgent.length}</b><span>Urgent</span></button>
        <button className={`mt-kpi green ${stage === "received" ? "on" : ""}`} onClick={() => setStage("received")}><b>{stats.arrived.length}</b><span>Arrived this month</span></button>
      </div>

      <div className="mt-bar">
        <div className="seg">
          {Object.entries(LISTS).map(([k, v]) => {
            const n = all.filter((m) => m.list_type === k && m.status !== "received").length;
            return <button key={k} className={list === k ? "on" : ""} onClick={() => pickList(k)}>{v.icon} {v.title} <span className="fcount">{n}</span></button>;
          })}
        </div>
        <div className="tk-views">
          {[["list", "📋 List"], ["board", "🗂️ Board"], ...(isOwner ? [["insights", "📊 Insights"]] : [])].map(([k, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}
        </div>
      </div>

      {view === "insights" && isOwner ? <Insights all={all} /> : (
        <>
          <AddRow list={list} cfg={cfg} open={all.filter((m) => m.status !== "received")} onAdded={materials.reload} />
          <div className="filter-bar">
            {[["open", "All open", open.length], ["pending", "Waiting for PO", stats.waiting.length], ["ordered", "PO raised", stats.raised.length], ["late", "Late", stats.late.length], ["received", "Arrived", null]].map(([k, l, n]) => (
              <button key={k} className={`filter-btn ${stage === k ? "active" : ""} ${k === "late" && n ? "warn" : ""}`} onClick={() => setStage(k)}>{l}{n !== null && <span className="fcount">{n}</span>}</button>
            ))}
            <select className="inp inp-filter" value={firm} onChange={(e) => setFirm(e.target.value)}><option value="">All firms</option>{FIRMS.map((f) => <option key={f}>{f}</option>)}</select>
            <div style={{ flex: 1 }} />
            <button className="btn-ghost" onClick={() => exportCsv(shown)}>⬇ Excel</button>
            <SearchBox value={q} onChange={setQ} placeholder="Search item, supplier, PO…" />
          </div>

          {view === "board" ? (
            <div className="mt-board">
              {["pending", "ordered", "received"].map((s) => {
                const items = (stage === "received" || stage === "open" ? live : shown).filter((m) => m.status === s)
                  .filter((m) => !q.trim() || [m.name, m.supplier, m.po_number].join(" ").toLowerCase().includes(q.trim().toLowerCase()))
                  .sort(s === "received" ? (a, b) => ((a.received_at || "") < (b.received_at || "") ? 1 : -1) : sortOpen).slice(0, s === "received" ? 15 : 200);
                return (
                  <div key={s} className="tk-col">
                    <div className="tk-col-h" style={{ borderTopColor: ST[s].c }}>{ST[s].label} <span>{s === "received" ? stats.arrived.length + " this month" : items.length}</span></div>
                    {items.length === 0 && <div className="tk-col-empty">Nothing here</div>}
                    {items.map((m) => <MaterialCard key={m.id} {...rowProps(m)} compact />)}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-list">
              {shown.length === 0 && <Empty>{stage === "open" ? "Nothing open — all requirements are covered ✅" : "Nothing here."}</Empty>}
              {stage === "received"
                ? shown.map((m) => <MaterialCard key={m.id} {...rowProps(m)} />)
                : groups.map(([label, items]) => items.length > 0 && (
                  <div key={label} className="tk-group"><div className="tk-group-h">{label} <span>{items.length}</span></div>
                    {items.map((m) => <MaterialCard key={m.id} {...rowProps(m)} />)}</div>
                ))}
            </div>
          )}
        </>
      )}

      {editing && <EditMaterial m={editing} cfg={LISTS[editing.list_type] || cfg} onClose={() => setEditing(null)} onSaved={materials.reload} />}
      {linking && <LinkModal m={linking} cfg={LISTS[linking.list_type] || cfg} onClose={() => setLinking(null)} onSaved={materials.reload} />}
      {ordering && <OrderModal m={ordering} onClose={() => setOrdering(null)} onSave={async (extra) => { await setStatus(ordering, "ordered", extra); setOrdering(null); }} />}
      {dialog}
    </div>
  );
}

// ── Item picker (purchase.velite.in item list) ───────────────────────
function useItemSearch(text, cfg, firm) {
  const [hits, setHits] = useState([]);
  useEffect(() => {
    const s = text.trim();
    if (s.length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      let qy = supabase.from("hub_pv_items").select("*").ilike("name", `%${s.replace(/[%_,()]/g, " ").split(/\s+/).join("%")}%`).limit(40);
      if (firm) qy = qy.eq("firm", firm);
      const { data } = await qy;
      const rows = (data || []).sort((a, b) =>
        Number(cfg.types.includes(b.item_type)) - Number(cfg.types.includes(a.item_type)) ||
        Number(!!b.lp_date) - Number(!!a.lp_date) || a.name.length - b.name.length).slice(0, 12);
      setHits(rows);
    }, 250);
    return () => clearTimeout(t);
  }, [text, firm]); // eslint-disable-line
  return hits;
}

function PvLine({ pv, price }) {
  if (!pv) return null;
  return (
    <div className="mt-pv">
      <span className={`mt-stock ${Number(pv.stock) > 0 ? "has" : ""}`}>📦 In stock: <b>{fmtQty(pv.stock)} {pv.unit}</b></span>
      {pv.lp_date
        ? <span>🧾 Last purchase: <b>{fmtDate(pv.lp_date)}</b> · {pv.lp_vendor || "—"} · {fmtQty(pv.lp_qty)} {pv.lp_unit}{price?.rate != null && <> · <b className="mt-rate">{inr(price.rate)}/{price.unit || pv.lp_unit}</b></>} <small>({pv.lp_po})</small></span>
        : <span className="small-muted">No purchase found yet</span>}
    </div>
  );
}

function AddRow({ list, cfg, open, onAdded }) {
  const { isOwner } = useData();
  const [name, setName] = useState("");
  const [pick, setPick] = useState(null);
  const [firm, setFirm] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState(cfg.units[0]);
  const [reqBy, setReqBy] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [forP, setForP] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const hits = useItemSearch(pick ? "" : name, cfg, firm);
  const [, prices] = usePv(pick ? [pick.id] : [], isOwner);
  const dup = name.trim().length > 2 && open.find((m) => (pick && m.pv_item_id === pick.id) || m.name.trim().toLowerCase() === name.trim().toLowerCase());

  const choose = (it) => {
    setPick(it); setName(it.name); setFirm(it.firm || firm); setShow(false);
    const u = (it.unit || "").toLowerCase(); const match = cfg.units.find((x) => x.toLowerCase() === u);
    if (match) setUnit(match);
  };
  const clear = () => { setPick(null); setName(""); };
  const add = async () => {
    if (!name.trim() || busy) return;
    if (!firm) { toast("Choose the firm (VP / VH / VI / VS).", "err"); return; }
    setBusy(true);
    const r = await run(supabase.from("hub_materials").insert({
      list_type: list, name: name.trim(), qty, unit: cfg.units.includes(unit) ? unit : cfg.units[0], required_by: reqBy || null, urgent,
      firm_id: firm, pv_item_id: pick?.id || null, for_product: forP.trim() || null,
    }), urgent ? "Added — purchase has been told (urgent)" : "Added — purchase has been told");
    setBusy(false);
    if (r.ok) { clear(); setQty(""); setReqBy(""); setUrgent(false); setForP(""); onAdded(); }
  };
  return (
    <div className="mt-add">
      <div className="mt-add-row">
        <select className="inp mt-firm" value={firm} onChange={(e) => { setFirm(e.target.value); setPick(null); }} style={firm ? { borderColor: FIRM_COLORS[firm], color: FIRM_COLORS[firm], fontWeight: 700 } : {}}>
          <option value="">Firm…</option>{FIRMS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <div className="mt-name">
          <input className="inp" placeholder={`Type ${cfg.title.toLowerCase().replace(/s$/, "")} name — pick from purchase list…`} value={name}
            onChange={(e) => { setName(e.target.value); setPick(null); setShow(true); }} onFocus={() => setShow(true)} onBlur={() => setTimeout(() => setShow(false), 200)}
            onKeyDown={(e) => e.key === "Enter" && !show && add()} />
          {pick && <button className="mt-clear" onClick={clear} title="Clear">✕</button>}
          {show && hits.length > 0 && (
            <div className="mt-suggest">
              {hits.map((it) => (
                <button key={it.id} onMouseDown={() => choose(it)}>
                  <span className="tk-firm" style={{ background: FIRM_COLORS[it.firm] || "#64748b" }}>{it.firm}</span>
                  <span className="mt-s-name">{it.name}</span>
                  <span className={`mt-s-stock ${Number(it.stock) > 0 ? "has" : ""}`}>{fmtQty(it.stock)} {it.unit}</span>
                </button>
              ))}
              <div className="mt-s-foot">Not in the list? Just type the name and press Add.</div>
            </div>
          )}
        </div>
        <input className="inp inp-sm" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
        <select className="inp inp-xs" value={unit} onChange={(e) => setUnit(e.target.value)}>{cfg.units.map((u) => <option key={u}>{u}</option>)}</select>
      </div>
      <div className="mt-add-row">
        <input className="inp mt-forp" placeholder="For which product / batch (optional)" value={forP} onChange={(e) => setForP(e.target.value)} />
        <label className="mt-lbl">Needed by <input className="inp inp-date" type="date" value={reqBy} onChange={(e) => setReqBy(e.target.value)} /></label>
        <label className="chk"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent</label>
        <div style={{ flex: 1 }} />
        <button className="add-btn" style={{ background: cfg.color }} onClick={add} disabled={busy}>＋ Add requirement</button>
      </div>
      {pick && <PvLine pv={pick} price={prices[pick.id]} />}
      {dup && <div className="mt-dup">⚠️ Already requested: <b>{dup.name}</b> {dup.qty && `· ${dup.qty} ${dup.unit}`} · by {dup.created_by_name} · {ST[dup.status].label}</div>}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────
function MaterialCard({ m, pv, price, onOrder, onReceive, onBack, onEdit, onDelete, onLink, compact }) {
  const { isOwner, me, comments } = useData();
  const [open, setOpen] = useState(false);
  const due = m.status !== "received" && m.required_by ? dueLabel(m.required_by) : null;
  const late = isLate(m);
  const age = m.status === "pending" ? ageDays(m.created_at) : m.status === "ordered" && m.ordered_at ? ageDays(m.ordered_at) : null;
  const po = m.po_info;
  const nC = commentCount(comments, "material", m.id);
  const linked = !!m.pv_item_id;
  const share = encodeURIComponent(`*Material requirement*\n${m.firm_id ? m.firm_id + " · " : ""}${m.name}${m.qty ? ` — ${m.qty} ${m.unit}` : ""}${m.required_by ? `\nNeeded by: ${fmtDate(m.required_by)}` : ""}${m.urgent ? "\n*URGENT*" : ""}${m.for_product ? `\nFor: ${m.for_product}` : ""}\n\nhttps://hub.velite.in/#materials`);
  return (
    <div className={`mt-card st-${m.status} ${late ? "late" : ""} ${m.urgent && m.status !== "received" ? "is-urgent" : ""}`}>
      <div className="mt-card-top">
        <div className="mt-title">
          {m.firm_id && <span className="tk-firm" style={{ background: FIRM_COLORS[m.firm_id] }}>{m.firm_id}</span>}
          {m.urgent && m.status !== "received" && <span className="urgent">URGENT</span>}
          <b>{m.name}</b>{m.qty && <span className="qty"> — {m.qty} {m.unit}</span>}
        </div>
        <span className="mt-st" style={{ background: late ? "#dc2626" : ST[m.status].c }}>{late ? "Delivery late" : ST[m.status].label}</span>
      </div>
      <div className="mt-meta">
        {age !== null && <span className={`mt-age ${age >= 7 ? "red" : age >= 3 ? "amber" : ""}`}>{m.status === "pending" ? `⏳ Waiting ${age} day${age === 1 ? "" : "s"}` : `🛒 PO ${age} day${age === 1 ? "" : "s"} ago`}</span>}
        {due && <span className={`due ${due.cls}`}>📅 Needed {due.text}</span>}
        {m.for_product && <span>🎯 For {m.for_product}</span>}
        <span>➕ {m.created_by_name || "—"} · {fmtDateTime(m.created_at)}</span>
      </div>
      {(m.status !== "pending" || po) && (
        <div className={`mt-po ${late ? "late" : ""}`}>
          🧾 <b>{m.po_number || po?.po || "PO"}</b>{(m.supplier || po?.v) && <> · {m.supplier || po?.v}</>}
          {po?.d && <> · raised {fmtDate(po.d)}</>}
          {po?.exp && m.status !== "received" && <> · expected <b className={late ? "chk-red" : ""}>{fmtDate(po.exp)}</b></>}
          {po && Number(po.rq) > 0 && m.status !== "received" && <> · <b>part arrived {fmtQty(po.rq)} of {fmtQty(po.q)} {po.u}</b></>}
          {m.status === "received" && <> · ✅ arrived {fmtDate((m.received_at || "").slice(0, 10))}</>}
          {m.ordered_by_name === "purchase.velite.in" && <small className="mt-auto"> auto</small>}
        </div>
      )}
      {!compact && <PvLine pv={pv} price={price} />}
      {m.notes && !compact && <div className="notes">{m.notes}</div>}
      <div className="mt-actions">
        {!linked && m.status !== "received" && <button className="mt-link" onClick={onLink}>🔗 Link to purchase item</button>}
        {!linked && m.status === "pending" && <button className="step-btn" onClick={onOrder}>Mark PO raised →</button>}
        {!linked && m.status === "ordered" && <button className="step-btn" onClick={onReceive}>Mark arrived →</button>}
        {m.status !== "pending" && (isOwner || !linked) && <button className="restore-btn" onClick={onBack} title="Move back one step">↩</button>}
        <div style={{ flex: 1 }} />
        <button className="icon-btn cb" title="Comments" onClick={() => setOpen((o) => !o)}>💬{nC > 0 && <span className="cnt">{nC}</span>}</button>
        <a className="icon-btn" title="Share on WhatsApp" href={`https://wa.me/?text=${share}`} target="_blank" rel="noreferrer">🟢</a>
        <button className="icon-btn edit" title="Edit" onClick={onEdit}>✎</button>
        {(isOwner || m.created_by === me.id) && <button className="icon-btn" title="Delete" onClick={onDelete}>🗑</button>}
      </div>
      {open && <Comments type="material" id={m.id} />}
    </div>
  );
}

// ── Link an old / typed request to a purchase item ───────────────────
function LinkModal({ m, cfg, onClose, onSaved }) {
  const { isOwner } = useData();
  const [text, setText] = useState(m.name.replace(/[@(].*$/, "").trim());
  const [firm, setFirm] = useState(m.firm_id || "");
  const [pick, setPick] = useState(null);
  const hits = useItemSearch(text, cfg, firm);
  const [, prices] = usePv(pick ? [pick.id] : [], isOwner);
  const save = async () => {
    if (!pick) { toast("Choose the matching item.", "err"); return; }
    const r = await run(supabase.from("hub_materials").update({ pv_item_id: pick.id, firm_id: pick.firm || firm || null }).eq("id", m.id), "Linked — PO and arrival will now update by themselves");
    if (r.ok) { await supabase.rpc("hub_pv_refresh"); onSaved(); onClose(); }
  };
  return (
    <Modal wide title={`🔗 Link “${m.name}” to purchase.velite.in`} onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Link</button></>}>
      <div className="form-hint" style={{ marginBottom: 10 }}>Pick the same item as in purchase.velite.in. After linking, “PO raised” and “Arrived” update by themselves, and stock and last purchase are shown.</div>
      <div className="form-grid">
        <Field label="Firm"><select className="form-inp" value={firm} onChange={(e) => setFirm(e.target.value)}><option value="">All firms</option>{FIRMS.map((f) => <option key={f}>{f}</option>)}</select></Field>
        <Field label="Search item"><input className="form-inp" value={text} onChange={(e) => { setText(e.target.value); setPick(null); }} autoFocus /></Field>
      </div>
      <div className="mt-pick">
        {hits.length === 0 && <div className="small-muted">Type at least 2 letters. Try a shorter word, e.g. “squal”.</div>}
        {hits.map((it) => (
          <button key={it.id} className={pick?.id === it.id ? "on" : ""} onClick={() => setPick(it)}>
            <span className="tk-firm" style={{ background: FIRM_COLORS[it.firm] || "#64748b" }}>{it.firm}</span>
            <span className="mt-s-name">{it.name}</span>
            <span className={`mt-s-stock ${Number(it.stock) > 0 ? "has" : ""}`}>{fmtQty(it.stock)} {it.unit}</span>
          </button>
        ))}
      </div>
      {pick && <PvLine pv={pick} price={prices[pick.id]} />}
    </Modal>
  );
}

function OrderModal({ m, onClose, onSave }) {
  const [supplier, setSupplier] = useState(m.supplier || "");
  const [po, setPo] = useState(m.po_number || "");
  return (
    <Modal title={`PO raised for “${m.name}”`} onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => onSave({ supplier: supplier.trim(), po_number: po.trim() })}>Save</button></>}>
      <div className="form-hint" style={{ marginBottom: 8 }}>Tip: use “🔗 Link to purchase item” instead — then this updates by itself.</div>
      <Field label="Supplier (optional)"><input className="form-inp" value={supplier} onChange={(e) => setSupplier(e.target.value)} autoFocus /></Field>
      <Field label="PO number (optional)" hint="e.g. VHP-4141"><input className="form-inp" value={po} onChange={(e) => setPo(e.target.value)} /></Field>
    </Modal>
  );
}

function EditMaterial({ m, cfg, onClose, onSaved }) {
  const [f, setF] = useState({
    name: m.name, qty: m.qty || "", unit: m.unit || cfg.units[0], required_by: m.required_by || "", urgent: m.urgent,
    firm_id: m.firm_id || "", for_product: m.for_product || "", notes: m.notes || "",
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const save = async () => {
    if (!f.name.trim()) return;
    const r = await run(supabase.from("hub_materials").update({ ...f, name: f.name.trim(), required_by: f.required_by || null, firm_id: f.firm_id || null, for_product: f.for_product || null }).eq("id", m.id), "Saved");
    if (r.ok) { onSaved(); onClose(); }
  };
  const units = cfg.units.includes(f.unit) ? cfg.units : [f.unit, ...cfg.units];
  return (
    <Modal title="Edit requirement" onClose={onClose}
      actions={<>{m.pv_item_id && <button className="btn-ghost" onClick={async () => { const r = await run(supabase.from("hub_materials").update({ pv_item_id: null, po_info: null }).eq("id", m.id), "Unlinked"); if (r.ok) { onSaved(); onClose(); } }}>Unlink purchase item</button>}
        <button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      <Field label="Item name"><input className="form-inp" value={f.name} onChange={set("name")} /></Field>
      <div className="form-grid">
        <Field label="Firm"><select className="form-inp" value={f.firm_id} onChange={set("firm_id")}><option value="">—</option>{FIRMS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Quantity"><input className="form-inp" value={f.qty} onChange={set("qty")} /></Field>
        <Field label="Unit"><select className="form-inp" value={f.unit} onChange={set("unit")}>{units.map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field label="Needed by"><input className="form-inp" type="date" value={f.required_by} onChange={set("required_by")} /></Field>
      </div>
      <Field label="For which product / batch"><input className="form-inp" value={f.for_product} onChange={set("for_product")} /></Field>
      <label className="chk" style={{ marginBottom: 12 }}><input type="checkbox" checked={f.urgent} onChange={set("urgent")} /> Urgent</label>
      <Field label="Notes"><textarea className="form-inp" value={f.notes} onChange={set("notes")} /></Field>
    </Modal>
  );
}

// ── Insights (owners) ────────────────────────────────────────────────
function Insights({ all }) {
  const since = Date.now() - 90 * 86400000;
  const recent = all.filter((m) => new Date(m.created_at).getTime() > since);
  const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;
  const toPo = recent.filter((m) => m.ordered_at).map((m) => days(m.created_at, m.ordered_at)).filter((d) => d >= 0);
  const toArr = recent.filter((m) => m.ordered_at && m.received_at).map((m) => days(m.ordered_at, m.received_at)).filter((d) => d >= 0);
  const avg = (a) => (a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : "–");
  const waiting = all.filter((m) => m.status === "pending");
  const buckets = [["Under 3 days", (d) => d < 3], ["3–7 days", (d) => d >= 3 && d < 7], ["7–15 days", (d) => d >= 7 && d < 15], ["Over 15 days", (d) => d >= 15]]
    .map(([l, f]) => [l, waiting.filter((m) => f(ageDays(m.created_at))).length]);
  const maxB = Math.max(1, ...buckets.map((b) => b[1]));
  const top = Object.entries(recent.reduce((o, m) => { const k = m.name.trim().toUpperCase(); o[k] = (o[k] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const m0 = todayISO().slice(0, 7); const d1 = new Date(); d1.setMonth(d1.getMonth() - 1); const m1 = d1.toISOString().slice(0, 7);
  const cnt = (mm, f) => all.filter((m) => (m[f] || "").slice(0, 7) === mm).length;
  const byFirm = FIRMS.map((f) => [f, all.filter((m) => m.firm_id === f && m.status !== "received").length]);
  return (
    <div className="mt-ins">
      <div className="mt-ins-kpis">
        <div><b>{avg(toPo)}</b><span>days, request → PO</span><small>last 90 days · {toPo.length} requests</small></div>
        <div><b>{avg(toArr)}</b><span>days, PO → arrived</span><small>last 90 days · {toArr.length} requests</small></div>
        <div><b>{cnt(m0, "created_at")}</b><span>requests this month</span><small>{cnt(m1, "created_at")} last month</small></div>
        <div><b>{cnt(m0, "received_at")}</b><span>arrived this month</span><small>{cnt(m1, "received_at")} last month</small></div>
      </div>
      <div className="mt-ins-grid">
        <div className="ipanel"><h3>⏳ Waiting for PO, by age</h3>
          {buckets.map(([l, n]) => <div key={l} className="mt-hbar"><span>{l}</span><div><i style={{ width: `${(100 * n) / maxB}%`, background: l.startsWith("Over") ? "#dc2626" : l.startsWith("7") ? "#f59e0b" : "#2563eb" }} /></div><b>{n}</b></div>)}
        </div>
        <div className="ipanel"><h3>🏢 Open requirements by firm</h3>
          {byFirm.map(([f, n]) => <div key={f} className="mt-hbar"><span><span className="tk-firm" style={{ background: FIRM_COLORS[f] }}>{f}</span></span><div><i style={{ width: `${(100 * n) / Math.max(1, ...byFirm.map((x) => x[1]))}%`, background: FIRM_COLORS[f] }} /></div><b>{n}</b></div>)}
          <div className="small-muted" style={{ marginTop: 6 }}>{all.filter((m) => !m.firm_id && m.status !== "received").length} open without a firm</div>
        </div>
        <div className="ipanel"><h3>🔁 Most requested (90 days)</h3>
          {top.length === 0 ? <div className="small-muted">No requests yet.</div> : <ol className="mt-top">{top.map(([n, c]) => <li key={n}><span>{n}</span><b>{c}×</b></li>)}</ol>}
        </div>
      </div>
    </div>
  );
}

function exportCsv(rows) {
  const head = ["Type", "Firm", "Item", "Qty", "Unit", "Status", "Urgent", "Needed by", "For", "Requested by", "Requested on", "PO", "Supplier", "PO date", "Expected", "Arrived on"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((m) => [m.list_type === "rm" ? "RM" : "PM", m.firm_id, m.name, m.qty, m.unit, ST[m.status].label, m.urgent ? "Yes" : "", m.required_by, m.for_product,
    m.created_by_name, (m.created_at || "").slice(0, 10), m.po_number, m.supplier, m.po_info?.d, m.po_info?.exp, (m.received_at || "").slice(0, 10)].map(esc).join(","));
  const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `material-requirements-${todayISO()}.csv`; a.click();
}

export function materialsSummary(rows) {
  const live = rows.filter((m) => !m.deleted_at && m.status !== "received");
  return {
    rmPending: live.filter((m) => m.list_type === "rm" && m.status === "pending").length,
    pmPending: live.filter((m) => m.list_type === "pm" && m.status === "pending").length,
    ordered: live.filter((m) => m.status === "ordered").length,
    hot: live.filter((m) => m.urgent || isLate(m) || (m.required_by && daysUntil(m.required_by) <= 3)).sort(sortOpen),
  };
}
