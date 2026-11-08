import { useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { daysUntil, fmtDate, todayISO, addDaysISO } from "../lib/dates";
import { Empty, SearchBox, Modal, Field } from "../components/ui";
import { Pill } from "./ipr/shared";
import {
  STATUS, isOpen, tone, dueBadge, personName, regenerate, exportCsv, applicability,
  DEPTS, deptStyle, firmColor, FirmBadge, DeptChip, GO_LIVE, ruleText,
} from "./compliance/common";
import ItemModal from "./compliance/ItemModal";
import Licences from "./compliance/Licences";
import Library from "./compliance/Library";
import Firms from "./compliance/Firms";

const VIEWS = [
  ["dash", "📊 Dashboard"], ["due", "📋 Due list"], ["cal", "🗓️ Calendar"], ["lic", "📜 Licences"], ["lib", "📚 Library"], ["firms", "🏢 Firm settings", true],
];
const BLANK = { firm: "all", dept: "all", show: "open", mine: false, q: "" };

export default function Compliance() {
  const d = useData();
  const [view, setView] = useState("dash");
  const [filter, setFilter] = useState(BLANK);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const loading = d.cmpItems.loading || d.cmpLib.loading || d.cmpFirms.loading;
  const goDue = (patch) => { setFilter({ ...BLANK, ...patch }); setView("due"); };
  const openItem = open && d.cmpItems.rows.find((i) => i.id === open.id);

  return (
    <div className="ipr cmp">
      <div className="cmp-hero">
        <div>
          <div className="cmp-hero-title">🛡️ Compliance Tracker</div>
          <div className="cmp-hero-sub">Every filing, renewal and check for all four Velite firms — one place, nothing missed.</div>
          <div className="cmp-hero-firms">{d.cmpFirms.rows.map((f) => <span key={f.id} className="cmp-hero-firm" style={{ borderColor: firmColor(f.id) }}><FirmBadge id={f.id} /> {f.name}</span>)}</div>
        </div>
        <div className="cmp-hero-actions">
          <button className="cmp-btn-add" onClick={() => setAdding(true)}>＋ Add an item</button>
          {d.isOwner && <button className="cmp-btn-light" onClick={async () => { await regenerate(); d.cmpItems.reload(); }}>↻ Refresh due dates</button>}
        </div>
      </div>
      <div className="cmp-tabs">
        {VIEWS.filter((v) => !v[2] || d.isOwner).map(([k, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}
      </div>
      {loading ? <div className="loading">Loading…</div> : <>
        {view === "dash" && <Dashboard goDue={goDue} onOpen={setOpen} goView={setView} />}
        {view === "due" && <DueList filter={filter} setFilter={setFilter} onOpen={setOpen} />}
        {view === "cal" && <Calendar onOpen={setOpen} />}
        {view === "lic" && <Licences />}
        {view === "lib" && <Library />}
        {view === "firms" && d.isOwner && <Firms />}
      </>}
      {openItem && <ItemModal item={openItem} quick={open.quick} onClose={() => setOpen(null)} />}
      {adding && <AddItemModal onClose={() => setAdding(false)} />}
    </div>
  );
}

const libOf = (d, code) => d.cmpLib.rows.find((l) => l.code === code);

function Row({ i, onOpen, select }) {
  const d = useData();
  const lib = libOf(d, i.code);
  const b = dueBadge(i); const st = STATUS[i.status];
  return (
    <div className={`cmp-row ${tone(i)}`} onClick={() => onOpen({ id: i.id })}>
      {select && <input type="checkbox" className="cmp-sel" checked={select.has(i.id)} onClick={(e) => e.stopPropagation()} onChange={() => select.toggle(i.id)} />}
      <span className="cmp-icon" style={{ background: deptStyle(lib?.dept).c + "18" }} title={lib?.dept}>{deptStyle(lib?.dept).icon}</span>
      <span className={`due ${b.cls} cmp-due`}>{b.text}</span>
      <FirmBadge id={i.firm_id} />
      <span className="cmp-title"><b>{lib?.title || i.code}</b> <span className="small-muted">· {i.period_label}</span></span>
      <span className="small-muted cmp-who">{personName(d.profiles, i.owner_id) || ""}</span>
      <Pill tone={st.tone}>{st.label}</Pill>
      {isOpen(i) && <button className="cmp-quick" title="Mark as done" onClick={(e) => { e.stopPropagation(); onOpen({ id: i.id, quick: true }); }}>✓ Done</button>}
    </div>
  );
}

function Ring({ pct, color, label }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <svg width="92" height="92" viewBox="0 0 92 92" className="cmp-ring">
      <circle cx="46" cy="46" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="9" />
      <circle cx="46" cy="46" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 46 46)" />
      <text x="46" y="51" textAnchor="middle" fontSize="19" fontWeight="700" fill="#fff">{label}</text>
    </svg>
  );
}

function Dashboard({ goDue, onOpen, goView }) {
  const d = useData();
  const items = d.cmpItems.rows.filter((i) => !i.deleted_at);
  const open = items.filter(isOpen);
  const n = (i) => daysUntil(i.due_date);
  const preLive = open.filter((i) => i.due_date < GO_LIVE);
  const over = open.filter((i) => n(i) < 0 && i.due_date >= GO_LIVE);
  const wk = open.filter((i) => n(i) >= 0 && n(i) <= 7);
  const mo = open.filter((i) => n(i) >= 0 && n(i) <= 30);
  const toCheck = items.filter((i) => i.status === "filed");
  const firms = d.cmpFirms.rows;
  const deptOf = (code) => libOf(d, code)?.dept;
  const depts = Object.keys(DEPTS).filter((x) => d.cmpLib.rows.some((l) => l.dept === x));

  // on-time score: items due since go-live (up to today) that were done by the due date
  const pastDue = items.filter((i) => i.due_date >= GO_LIVE && n(i) < 0 && i.status !== "na");
  const onTime = pastDue.filter((i) => (i.status === "filed" || i.status === "verified") && i.filed_on && i.filed_on <= i.due_date).length;
  const score = pastDue.length ? Math.round((onTime / pastDue.length) * 100) : 100;
  const scoreColor = score >= 90 ? "#4ade80" : score >= 70 ? "#fbbf24" : "#f87171";

  const missing = [];
  for (const f of firms) for (const l of d.cmpLib.rows.filter((x) => x.rule?.t === "licence" && x.active)) {
    if (!applicability(f, l, d.cmpAssign.rows).applies) continue;
    if (!d.cmpLic.rows.some((x) => !x.deleted_at && x.firm_id === f.id && x.code === l.code)) missing.push({ f, l });
  }
  const unassigned = open.filter((i) => !i.owner_id && n(i) <= 30 && n(i) >= 0).length;
  const assumed = firms.filter((f) => !f.flags?.confirmed);
  const risks = open.filter((i) => libOf(d, i.code)?.risk === "H" && n(i) >= 0 && n(i) <= 45).slice(0, 8);

  // workload: next 6 months, stacked by department
  const months = [...Array(6)].map((_, k) => { const t = new Date(todayISO()); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() + k); return t.toISOString().slice(0, 7); });
  const load = months.map((m) => { const by = {}; for (const i of open) if (i.due_date.startsWith(m)) { const dp = deptOf(i.code); by[dp] = (by[dp] || 0) + 1; } return by; });
  const maxLoad = Math.max(1, ...load.map((b) => Object.values(b).reduce((a, x) => a + x, 0)));

  // this week strip
  const days7 = [...Array(7)].map((_, k) => addDaysISO(todayISO(), k));

  return (
    <>
      {d.isOwner && preLive.length > 0 && (
        <div className="cmp-catch">
          <div><b>🧹 Catch-up: {preLive.length} items fell due before the tracker started (8 Nov).</b><br />
            Most were probably done already. Tick the ones that were done and press “Mark as already done”; anything left is a real gap to fix.</div>
          <button className="cmp-btn-add" onClick={() => goDue({ show: "prelive" })}>Review now →</button>
        </div>
      )}
      {d.isOwner && assumed.length > 0 && (
        <div className="cmp-alert">⚠️ Firm settings for <b>{assumed.map((f) => f.id).join(", ")}</b> are not yet confirmed — <button className="link-btn strong" onClick={() => goView("firms")}>check them</button> so only the right compliances appear.</div>
      )}

      <div className="cmp-kpis">
        <div className="cmp-kpi score"><Ring pct={score} color={scoreColor} label={`${score}%`} /><div><span>On-time score</span><small>{pastDue.length ? `${onTime} of ${pastDue.length} done on time since 8 Nov` : "Starts counting from 8 Nov"}</small></div></div>
        <div className="cmp-kpi red" onClick={() => goDue({ show: "overdue" })}><span>Overdue</span><strong>{over.length}</strong><small>after go-live</small></div>
        <div className="cmp-kpi amber" onClick={() => goDue({ show: "7" })}><span>Due in 7 days</span><strong>{wk.length}</strong><small>act now</small></div>
        <div className="cmp-kpi blue" onClick={() => goDue({ show: "30" })}><span>Due in 30 days</span><strong>{mo.length}</strong><small>{unassigned} with no one responsible</small></div>
        <div className="cmp-kpi teal" onClick={() => goDue({ show: "filed" })}><span>Filed – to check</span><strong>{toCheck.length}</strong><small>waiting for checker</small></div>
      </div>

      <div className="ipanel">
        <div className="ipanel-head"><div><h3>📆 This week</h3><p>What falls due each day for the next 7 days.</p></div></div>
        <div className="cmp-week">{days7.map((day, k) => {
          const list = open.filter((i) => i.due_date === day);
          return (
            <div key={day} className={`cmp-day ${k === 0 ? "today" : ""}`}>
              <div className="cmp-day-h">{k === 0 ? "Today" : new Date(day).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}<span>{fmtDate(day).slice(0, 6)}</span></div>
              {list.length === 0 && <div className="cmp-day-free">free</div>}
              {list.slice(0, 4).map((i) => { const l = libOf(d, i.code); return (
                <div key={i.id} className="cmp-day-item" style={{ borderLeftColor: deptStyle(l?.dept).c }} onClick={() => onOpen({ id: i.id })}>
                  <b style={{ color: firmColor(i.firm_id) }}>{i.firm_id}</b> {l?.title}</div>); })}
              {list.length > 4 && <div className="cmp-day-free" onClick={() => goDue({ show: "7" })}>+{list.length - 4} more</div>}
            </div>);
        })}</div>
      </div>

      <div className="cmp-two">
        <div className="ipanel">
          <div className="ipanel-head"><div><h3>🔥 High-risk items in the next 45 days</h3><p>Missing these costs the most (licence loss, prosecution, heavy fees).</p></div></div>
          {risks.length === 0 ? <Empty>No high-risk items coming up. 👍</Empty> : risks.map((i) => <Row key={i.id} i={i} onOpen={onOpen} />)}
        </div>
        <div className="ipanel">
          <div className="ipanel-head"><div><h3>📈 Workload — next 6 months</h3><p>Open items per month, coloured by department. Plan staff and CA time early.</p></div></div>
          <div className="cmp-bars">{months.map((m, k) => {
            const by = load[k]; const tot = Object.values(by).reduce((a, x) => a + x, 0);
            return (
              <div key={m} className="cmp-bar-col">
                <div className="cmp-bar-n">{tot}</div>
                <div className="cmp-bar" style={{ height: `${(tot / maxLoad) * 150}px` }}>
                  {Object.entries(by).map(([dp, c]) => <div key={dp} title={`${dp}: ${c}`} style={{ flex: c, background: deptStyle(dp).c }} />)}
                </div>
                <div className="cmp-bar-m">{new Date(m + "-01").toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })}</div>
              </div>);
          })}</div>
          <div className="cmp-legend">{depts.map((x) => <span key={x}><i style={{ background: deptStyle(x).c }} />{deptStyle(x).icon} {x}</span>)}</div>
        </div>
      </div>

      <div className="ipanel">
        <div className="ipanel-head"><div><h3>🩺 Health by firm and department</h3><p>🔴 overdue · 🟠 due within 7 days · 🟢 on track (number = open items in next 30 days). Click a box.</p></div></div>
        <div className="table-wrap">
          <table className="tbl cmp-grid">
            <thead><tr><th>Department</th>{firms.map((f) => <th key={f.id} title={f.name}><FirmBadge id={f.id} /></th>)}</tr></thead>
            <tbody>{depts.map((dep) => (
              <tr key={dep}><td><DeptChip dept={dep} /></td>{firms.map((f) => {
                const mine = open.filter((i) => i.firm_id === f.id && deptOf(i.code) === dep && i.due_date >= GO_LIVE);
                const o = mine.filter((i) => n(i) < 0).length;
                const a = mine.filter((i) => n(i) >= 0 && n(i) <= 7).length;
                const m = mine.filter((i) => n(i) >= 0 && n(i) <= 30).length;
                const any = d.cmpLib.rows.some((l) => l.dept === dep && applicability(f, l, d.cmpAssign.rows).applies);
                return <td key={f.id}>{any ? <button className={`cmp-cell ${o ? "red" : a ? "amber" : "green"}`} onClick={() => goDue({ firm: f.id, dept: dep, show: o ? "overdue" : "30" })}>{o ? `${o} late` : m || "✓"}</button> : <span className="small-muted">—</span>}</td>;
              })}</tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="ipanel">
        <div className="ipanel-head"><div><h3>📜 Licences not yet in the register ({missing.length})</h3><p>These renewals cannot be reminded until you enter the licence with its next due date.</p></div>
          <button className="cmp-btn-add" onClick={() => goView("lic")}>Add licences →</button></div>
        {missing.length === 0 ? <Empty>All licence renewals are tracked. 🎉</Empty> : (
          <div className="cmp-missing">{missing.map(({ f, l }) => (
            <div key={f.id + l.code} className="cmp-miss" style={{ borderLeftColor: deptStyle(l.dept).c }}>
              <FirmBadge id={f.id} /> <span className="cmp-miss-t">{deptStyle(l.dept).icon} {l.title}</span>{l.risk === "H" && <Pill tone="red">High risk</Pill>}</div>
          ))}</div>
        )}
      </div>
    </>
  );
}

function DueList({ filter, setFilter, onOpen }) {
  const d = useData();
  const set = (k, v) => setFilter({ ...filter, [k]: v });
  const [sel, setSel] = useState(new Set());
  const libBy = useMemo(() => Object.fromEntries(d.cmpLib.rows.map((l) => [l.code, l])), [d.cmpLib.rows]);
  const q = filter.q.trim().toLowerCase();
  const rows = d.cmpItems.rows.filter((i) => {
    if (i.deleted_at) return false;
    if (filter.firm !== "all" && i.firm_id !== filter.firm) return false;
    if (filter.dept !== "all" && libBy[i.code]?.dept !== filter.dept) return false;
    if (filter.mine && i.owner_id !== d.me.id && i.checker_id !== d.me.id) return false;
    const n = daysUntil(i.due_date);
    switch (filter.show) {
      case "open": if (!isOpen(i)) return false; break;
      case "prelive": if (!isOpen(i) || i.due_date >= GO_LIVE) return false; break;
      case "overdue": if (!isOpen(i) || n >= 0 || i.due_date < GO_LIVE) return false; break;
      case "overdue_all": if (!isOpen(i) || n >= 0) return false; break;
      case "7": if (!isOpen(i) || n > 7) return false; break;
      case "30": if (!isOpen(i) || n > 30) return false; break;
      case "filed": if (i.status !== "filed") return false; break;
      case "done": if (!["filed", "verified", "na"].includes(i.status)) return false; break;
      default: break;
    }
    if (q) { const l = libBy[i.code]; if (!`${l?.title} ${l?.dept} ${l?.form} ${i.period_label} ${i.firm_id} ${i.ref_no || ""}`.toLowerCase().includes(q)) return false; }
    return true;
  });
  const groups = {};
  for (const i of rows) { const k = i.due_date.slice(0, 7); (groups[k] = groups[k] || []).push(i); }
  const selectable = d.isOwner && filter.show === "prelive";
  const select = selectable ? { has: (id) => sel.has(id), toggle: (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); } } : null;

  const markDone = async () => {
    if (!sel.size) { toast("Tick the items that were already done.", "err"); return; }
    const r = await run(supabase.rpc("hub_cmp_mark_predone", { p_ids: [...sel] }));
    if (r.ok) { toast(`${r.data} item(s) marked as already done`); setSel(new Set()); d.cmpItems.reload(); }
  };
  const csv = () => exportCsv([["Firm", "Department", "Compliance", "Period", "Due date", "Status", "Responsible", "Checker", "Filed on", "Reference", "Proof link", "Law", "Form", "Portal"],
    ...rows.map((i) => { const l = libBy[i.code] || {}; return [i.firm_id, l.dept, l.title, i.period_label, i.due_date, STATUS[i.status].label, personName(d.profiles, i.owner_id), personName(d.profiles, i.checker_id), i.filed_on, i.ref_no, i.proof_link, l.law, l.form, l.portal]; })],
    `velite-compliance-${todayISO()}.csv`);

  return (
    <div className="ipanel">
      <div className="cmp-quickfilters">
        {[["open", "All open"], ["overdue", "🔴 Overdue"], ["7", "🟠 Next 7 days"], ["30", "🔵 Next 30 days"], ["filed", "🟢 To check"], ["done", "✅ Done"], ...(d.isOwner ? [["prelive", "🧹 Catch-up"]] : [])].map(([k, l]) => (
          <button key={k} className={`filter-btn ${filter.show === k ? "active" : ""}`} onClick={() => set("show", k)}>{l}</button>))}
        <button className={`filter-btn ${filter.mine ? "active" : ""}`} onClick={() => set("mine", !filter.mine)}>👤 Only mine</button>
      </div>
      <div className="filter-bar" style={{ margin: "8px 0 10px" }}>
        <select className="inp inp-filter" value={filter.firm} onChange={(e) => set("firm", e.target.value)}>
          <option value="all">All firms</option>{d.cmpFirms.rows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <select className="inp inp-filter" value={filter.dept} onChange={(e) => set("dept", e.target.value)}>
          <option value="all">All departments</option>{Object.keys(DEPTS).map((x) => <option key={x} value={x}>{deptStyle(x).icon} {x}</option>)}</select>
        <SearchBox value={filter.q} onChange={(v) => set("q", v)} placeholder="Search e.g. GSTR, PF, licence…" />
        <button className="btn-ghost" onClick={csv}>⬇ Excel</button>
      </div>
      {selectable && (
        <div className="cmp-catch small">
          <span>Tick what was <b>already done</b> before 8 Nov, then press the button. {sel.size} ticked.</span>
          <span style={{ display: "flex", gap: 6 }}>
            <button className="btn-ghost" onClick={() => setSel(new Set(rows.map((r) => r.id)))}>Tick all</button>
            <button className="btn-ghost" onClick={() => setSel(new Set())}>Clear</button>
            <button className="cmp-btn-add" onClick={markDone}>✓ Mark as already done</button>
          </span>
        </div>
      )}
      <div className="small-muted" style={{ marginBottom: 8 }}>{rows.length} item{rows.length === 1 ? "" : "s"}</div>
      {rows.length === 0 && <Empty>Nothing here. 🎉</Empty>}
      {Object.entries(groups).map(([k, list]) => (
        <div key={k} className="cmp-month">
          <div className="cmp-month-h">{new Date(k + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })} <span>{list.length}</span></div>
          {list.map((i) => <Row key={i.id} i={i} onOpen={onOpen} select={select} />)}
        </div>
      ))}
    </div>
  );
}

function Calendar({ onOpen }) {
  const d = useData();
  const [ym, setYm] = useState(todayISO().slice(0, 7));
  const [firm, setFirm] = useState("all");
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7; // Monday first
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(startPad).fill(null), ...[...Array(daysIn)].map((_, k) => `${ym}-${String(k + 1).padStart(2, "0")}`)];
  const move = (k) => { const t = new Date(Date.UTC(y, m - 1 + k, 1)); setYm(t.toISOString().slice(0, 7)); };
  const items = d.cmpItems.rows.filter((i) => !i.deleted_at && i.due_date.startsWith(ym) && (firm === "all" || i.firm_id === firm));
  const today = todayISO();
  return (
    <div className="ipanel">
      <div className="cmp-cal-top">
        <button className="btn-ghost" onClick={() => move(-1)}>‹</button>
        <h3>{first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</h3>
        <button className="btn-ghost" onClick={() => move(1)}>›</button>
        <button className="filter-btn" onClick={() => setYm(today.slice(0, 7))}>Today</button>
        <select className="inp inp-filter" value={firm} onChange={(e) => setFirm(e.target.value)}><option value="all">All firms</option>{d.cmpFirms.rows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <span className="small-muted">{items.length} items · {items.filter(isOpen).length} open</span>
      </div>
      <div className="cmp-cal">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((x) => <div key={x} className="cmp-cal-h">{x}</div>)}
        {cells.map((day, k) => {
          if (!day) return <div key={k} className="cmp-cal-c empty" />;
          const list = items.filter((i) => i.due_date === day);
          return (
            <div key={day} className={`cmp-cal-c ${day === today ? "today" : ""} ${day < today ? "past" : ""}`}>
              <div className="cmp-cal-d">{Number(day.slice(8))}</div>
              {list.slice(0, 4).map((i) => { const l = libOf(d, i.code); const done = !isOpen(i); return (
                <div key={i.id} className={`cmp-cal-i ${done ? "done" : tone(i)}`} style={{ borderLeftColor: deptStyle(l?.dept).c }} onClick={() => onOpen({ id: i.id })} title={`${i.firm_id} · ${l?.title}`}>
                  <b style={{ color: firmColor(i.firm_id) }}>{i.firm_id}</b> {done ? "✓ " : ""}{l?.title}</div>); })}
              {list.length > 4 && <div className="cmp-cal-more">+{list.length - 4} more</div>}
            </div>);
        })}
      </div>
    </div>
  );
}

function AddItemModal({ onClose }) {
  const d = useData();
  const [firm, setFirm] = useState(d.cmpFirms.rows[0]?.id);
  const [code, setCode] = useState("GN01");
  const [label, setLabel] = useState("");
  const [due, setDue] = useState(addDaysISO(todayISO(), 7));
  const [busy, setBusy] = useState(false);
  const lib = libOf(d, code);
  const events = d.cmpLib.rows.filter((l) => l.active && l.rule?.t === "event");
  const others = d.cmpLib.rows.filter((l) => l.active && l.rule?.t !== "event");
  const save = async () => {
    if (!label.trim()) { toast("Write what it is about.", "err"); return; }
    setBusy(true);
    const a = d.cmpAssign.rows.find((x) => x.firm_id === firm && x.code === code);
    const r = await run(supabase.from("hub_cmp_items").insert({ firm_id: firm, code, period_key: `E:${Date.now()}`, period_label: label.trim(),
      due_date: due, manual: true, owner_id: a?.owner_id || null, checker_id: a?.checker_id || null }), "Item added");
    setBusy(false);
    if (r.ok) { d.cmpItems.reload(); onClose(); }
  };
  return (
    <Modal title="＋ Add a compliance item" onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>Add</button></>}>
      <p className="small-muted" style={{ marginBottom: 10 }}>Use this for a notice, an inspection reply, a new product, a staff change — anything that needs action by a date.</p>
      <Field label="Firm"><select className="inp" value={firm} onChange={(e) => setFirm(e.target.value)}>{d.cmpFirms.rows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
      <Field label="Type">
        <select className="inp" value={code} onChange={(e) => { setCode(e.target.value); const l = libOf(d, e.target.value); if (l?.rule?.t === "event" && l.rule.offset > 0) setDue(addDaysISO(todayISO(), l.rule.offset)); }}>
          <optgroup label="Happens when an event occurs">{events.map((l) => <option key={l.code} value={l.code}>{deptStyle(l.dept).icon} {l.title}</option>)}</optgroup>
          <optgroup label="Regular items (extra one-off)">{others.map((l) => <option key={l.code} value={l.code}>{deptStyle(l.dept).icon} {l.title}</option>)}</optgroup>
        </select>
        {lib && <div className="form-hint">{ruleText(lib.rule)}{lib.law && lib.law !== "—" ? ` · ${lib.law}` : ""}</div>}
      </Field>
      <Field label="What is it about?"><input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. FDA letter dated 5 Nov – reply needed" /></Field>
      <Field label="Due date"><input className="inp" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
    </Modal>
  );
}
