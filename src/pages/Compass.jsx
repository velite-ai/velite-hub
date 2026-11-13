import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { fmtDate, fmtDateTime, dueLabel, daysUntil, todayISO } from "../lib/dates";
import Comments from "../components/Comments";
import { Modal, Field, Empty, useConfirm } from "../components/ui";
import { FIRM_COLORS } from "./compliance/common";
import { TaskModal, Avatar } from "./Tasks";

const FIRMS = ["VP", "VH", "VI", "VS"];
const CO_CATS = ["Sales & growth", "Export", "New products", "Plant & capacity", "Quality & compliance", "People & team", "Finance", "Systems & digital", "Brand & marketing", "Other"];
const PE_CATS = ["Health & fitness", "Family", "Learning", "Reading", "Spiritual & mind", "Travel", "Wealth", "Hobby", "Other"];
const STATUS = { on_track: { l: "On track", c: "#16a34a", i: "🟢" }, at_risk: { l: "At risk", c: "#f59e0b", i: "🟠" }, off_track: { l: "Off track", c: "#dc2626", i: "🔴" } };
const MEASURES = [["tasks", "By steps done (milestones + tasks)"], ["number", "By a number (e.g. sales ₹ crore, countries, kg)"], ["manual", "I will set the % myself"]];

export function currentFY(d = new Date()) { const y = d.getFullYear(), m = d.getMonth() + 1; const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; }
const fyEnd = (fy) => `${Number(fy.slice(0, 4)) + 1}-03-31`;
const nextFY = (fy) => { const s = Number(fy.slice(0, 4)) + 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };

// progress 0–100 for a goal
export function progressOf(g, items, tasks) {
  if (g.achieved) return 100;
  if (g.measure === "manual") return Math.max(0, Math.min(100, g.manual_pct || 0));
  if (g.measure === "number") {
    const s = Number(g.start_value || 0), t = Number(g.target_value), c = Number(g.current_value ?? s);
    if (!t || t === s) return 0;
    return Math.max(0, Math.min(100, Math.round((100 * (c - s)) / (t - s))));
  }
  const ms = items.filter((i) => i.goal_id === g.id);
  const ts = tasks.filter((t) => t.goal_id === g.id && !t.deleted_at);
  const all = ms.length + ts.length;
  if (!all) return 0;
  return Math.round((100 * (ms.filter((i) => i.done).length + ts.filter((t) => t.status === "Done").length)) / all);
}
export const goalProgress = (items) => (items.length ? Math.round((100 * items.filter((i) => i.done).length) / items.length) : 0);

function Ring({ pct, size = 54, color = "#2563eb" }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="gc-ring">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#eef1f5" strokeWidth="7" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="7" fill="none" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="54%" textAnchor="middle" fontSize={size * 0.26} fontWeight="800" fill="#172033">{pct}%</text>
    </svg>
  );
}
// expected progress by today, so "behind plan" can be shown
function expectedPct(g) {
  const end = g.target_date || (g.fy ? fyEnd(g.fy) : null);
  if (!end || !g.fy) return null;
  const start = new Date(`${g.fy.slice(0, 4)}-04-01`).getTime(), e = new Date(end).getTime(), now = Date.now();
  if (e <= start) return null;
  return Math.max(0, Math.min(100, Math.round((100 * (now - start)) / (e - start))));
}

export default function Compass() {
  const { goals, goalItems, tasks, me, profiles } = useData();
  const [scope, setScope] = useState("company");
  const [fy, setFy] = useState(currentFY());
  const [firm, setFirm] = useState("");
  const [edit, setEdit] = useState(null);
  const [open, setOpen] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const live = goals.rows.filter((g) => !g.deleted_at && g.scope === scope && (scope === "company" || g.created_by === me.id));
  const visions = live.filter((g) => g.level === "vision");
  const yearGoals = live.filter((g) => g.level === "goal" && (g.fy || currentFY()) === fy && (!firm || g.firm_id === firm));
  const activeGoals = yearGoals.filter((g) => !g.achieved);
  const pr = (g) => progressOf(g, goalItems.rows, tasks.rows);
  const fys = [...new Set([currentFY(), nextFY(currentFY()), ...live.filter((g) => g.fy).map((g) => g.fy)])].sort();
  const counts = { on: activeGoals.filter((g) => g.status === "on_track").length, risk: activeGoals.filter((g) => g.status === "at_risk").length, off: activeGoals.filter((g) => g.status === "off_track").length };
  const avg = activeGoals.length ? Math.round(activeGoals.reduce((s, g) => s + pr(g), 0) / activeGoals.length) : 0;
  const dueMs = goalItems.rows.filter((i) => !i.done && i.due_date && daysUntil(i.due_date) <= 30 && yearGoals.some((g) => g.id === i.goal_id));
  const openGoal = goals.rows.find((g) => g.id === open);

  const groups = [...visions.map((v) => [v, activeGoals.filter((g) => g.parent_id === v.id)]), [null, activeGoals.filter((g) => !g.parent_id || !visions.some((v) => v.id === g.parent_id))]];

  return (
    <div className="section gc">
      <div className={`gc-hero ${scope}`}>
        <div>
          <div className="gc-hero-title">🧭 Business Compass</div>
          <div className="gc-hero-sub">{scope === "company" ? "Company goals — seen only by Sanjiv, Sangeeta and Piyush" : "My personal goals — private, only you can see them"}</div>
        </div>
        <div className="gc-hero-btns">
          <button className="tk-add" onClick={() => setEdit({ level: "goal", scope })}>＋ New goal</button>
          <button className="gc-ghost" onClick={() => setEdit({ level: "vision", scope })}>＋ Long-term vision</button>
        </div>
      </div>

      <div className="mt-bar">
        <div className="seg">
          <button className={scope === "company" ? "on" : ""} onClick={() => setScope("company")}>🏢 Company goals</button>
          <button className={scope === "personal" ? "on" : ""} onClick={() => setScope("personal")}>🙋 My personal goals</button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {scope === "company" && <select className="inp inp-filter" value={firm} onChange={(e) => setFirm(e.target.value)}><option value="">All firms</option>{FIRMS.map((f) => <option key={f}>{f}</option>)}</select>}
          <select className="inp inp-filter" value={fy} onChange={(e) => setFy(e.target.value)}>{fys.map((f) => <option key={f} value={f}>Year {f}</option>)}</select>
        </div>
      </div>

      <div className="gc-kpis">
        <div><b>{activeGoals.length}</b><span>Goals this year</span></div>
        <div className="blue"><b>{avg}%</b><span>Average progress</span></div>
        <div className="green"><b>{counts.on}</b><span>🟢 On track</span></div>
        <div className="amber"><b>{counts.risk}</b><span>🟠 At risk</span></div>
        <div className="red"><b>{counts.off}</b><span>🔴 Off track</span></div>
        <div><b>{dueMs.length}</b><span>Milestones due in 30 days</span></div>
      </div>

      {visions.length === 0 && activeGoals.length === 0 && (
        <div className="gc-empty">
          <div className="gc-empty-t">{scope === "company" ? "Start with the big picture" : "What do you want for yourself this year?"}</div>
          <ol>
            <li>Add 2–4 <b>long-term visions</b> ({scope === "company" ? "e.g. “VS plant running at full capacity by 2029”, “Exports to 25 countries”" : "e.g. “Fit and healthy at 60”, “Read 24 books a year”"}).</li>
            <li>Under each, add this year’s <b>goals</b> with a target date and how progress is measured.</li>
            <li>Break each goal into <b>milestones</b>, and turn them into <b>tasks</b> with a person and a date.</li>
            <li>Once a month, give each goal a quick <b>check-in</b>: on track, at risk or off track.</li>
          </ol>
        </div>
      )}

      {groups.map(([v, list]) => (v || list.length > 0) && (
        <div key={v?.id || "none"} className="gc-vision">
          {v ? (
            <div className="gc-vision-h">
              <span className="gc-vision-ic">🌟</span>
              <div style={{ flex: 1 }}><div className="gc-vision-t">{v.title}</div>{v.description && <div className="gc-vision-d">{v.description}</div>}</div>
              <span className="small-muted">{list.length} goal{list.length === 1 ? "" : "s"} this year</span>
              <button className="icon-btn edit" onClick={() => setEdit(v)}>✎</button>
              <button className="mt-link" onClick={() => setEdit({ level: "goal", scope, parent_id: v.id })}>＋ Goal</button>
            </div>
          ) : visions.length > 0 && <div className="gc-vision-h plain"><div className="gc-vision-t">Other goals</div></div>}
          <div className="gc-grid">
            {list.sort((a, b) => (a.target_date || "9") < (b.target_date || "9") ? -1 : 1).map((g) => <GoalCard key={g.id} g={g} pct={pr(g)} onOpen={() => setOpen(g.id)} />)}
            {v && list.length === 0 && <div className="gc-none">No goals for {fy} yet under this vision.</div>}
          </div>
        </div>
      ))}

      {yearGoals.some((g) => g.achieved) && (
        <div className="archive-wrap">
          <button className="link-btn" onClick={() => setShowDone((x) => !x)}>🏆 Achieved this year ({yearGoals.filter((g) => g.achieved).length}) {showDone ? "▲" : "▼"}</button>
          {showDone && <div className="gc-grid" style={{ marginTop: 8 }}>{yearGoals.filter((g) => g.achieved).map((g) => <GoalCard key={g.id} g={g} pct={100} onOpen={() => setOpen(g.id)} />)}</div>}
        </div>
      )}

      {edit && <GoalModal goal={edit.id ? edit : null} preset={edit} visions={visions} fy={fy} onClose={() => setEdit(null)} />}
      {openGoal && <GoalDetail g={openGoal} pct={pr(openGoal)} onClose={() => setOpen(null)} onEdit={() => { setEdit(openGoal); setOpen(null); }} people={profiles.rows} />}
    </div>
  );
}

function GoalCard({ g, pct, onOpen }) {
  const { goalItems, tasks, profiles } = useData();
  const ms = goalItems.rows.filter((i) => i.goal_id === g.id);
  const ts = tasks.rows.filter((t) => t.goal_id === g.id && !t.deleted_at);
  const exp = expectedPct(g);
  const behind = !g.achieved && exp !== null && pct + 15 < exp;
  const owner = profiles.rows.find((p) => p.id === g.owner_id)?.full_name || g.owner_name;
  const st = STATUS[g.status];
  const late = ts.filter((t) => t.status !== "Done" && t.due_date && daysUntil(t.due_date) < 0).length;
  const color = g.achieved ? "#16a34a" : st?.c || (behind ? "#f59e0b" : "#2563eb");
  return (
    <div className={`gc-card ${g.achieved ? "won" : ""}`} onClick={onOpen} style={{ borderTopColor: color }}>
      <div className="gc-card-top">
        <Ring pct={pct} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="gc-title">{g.firm_id && <span className="tk-firm" style={{ background: FIRM_COLORS[g.firm_id] }}>{g.firm_id}</span>}{g.title}</div>
          <div className="gc-sub">{g.category && <span>{g.category}</span>}{g.target_date && <span>🎯 {fmtDate(g.target_date)}</span>}</div>
        </div>
      </div>
      {g.measure === "number" && g.target_value != null && <div className="gc-num">{Number(g.current_value ?? g.start_value ?? 0).toLocaleString("en-IN")} of <b>{Number(g.target_value).toLocaleString("en-IN")}</b> {g.unit}</div>}
      <div className="gc-foot">
        {owner && <span className="tk-who"><Avatar name={owner} size={20} />{owner.split(" ")[0]}</span>}
        <span>🏁 {ms.filter((i) => i.done).length}/{ms.length}</span>
        <span>✅ {ts.filter((t) => t.status === "Done").length}/{ts.length} tasks</span>
        {late > 0 && <span className="chk-red">{late} late</span>}
        {g.achieved ? <span className="gc-st" style={{ background: "#16a34a" }}>🏆 Achieved</span>
          : st ? <span className="gc-st" style={{ background: st.c }}>{st.l}</span>
          : behind ? <span className="gc-st" style={{ background: "#f59e0b" }}>Behind plan</span> : null}
      </div>
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────
function GoalDetail({ g, pct, onClose, onEdit, people }) {
  const { goals, goalItems, tasks, me } = useData();
  const [checkins, setCheckins] = useState(null);
  const [ms, setMs] = useState({ text: "", due_date: "", owner_id: "" });
  const [taskFor, setTaskFor] = useState(null);
  const [ci, setCi] = useState({ status: g.status || "on_track", note: "", value: "" });
  const [ask, dialog] = useConfirm();
  const items = goalItems.rows.filter((i) => i.goal_id === g.id).sort((a, b) => (a.due_date || "9") < (b.due_date || "9") ? -1 : 1);
  const gt = tasks.rows.filter((t) => t.goal_id === g.id && !t.deleted_at);
  const owners = people.filter((p) => p.role === "owner" && p.status === "approved");
  const exp = expectedPct(g);
  const personal = g.scope === "personal";

  useEffect(() => { supabase.from("hub_goal_checkins").select("*").eq("goal_id", g.id).order("at", { ascending: false }).then(({ data }) => setCheckins(data || [])); }, [g.id]); // eslint-disable-line

  const addMs = async () => {
    if (!ms.text.trim()) return;
    const r = await run(supabase.from("hub_goal_items").insert({ goal_id: g.id, text: ms.text.trim(), due_date: ms.due_date || null, owner_id: ms.owner_id || null }), "Milestone added");
    if (r.ok) { setMs({ text: "", due_date: "", owner_id: "" }); goalItems.reload(); }
  };
  const toggleMs = async (i) => { const r = await run(supabase.from("hub_goal_items").update({ done: !i.done }).eq("id", i.id)); if (r.ok) goalItems.reload(); };
  const delMs = async (i) => { if (await ask({ title: "Remove this milestone?", body: i.text, okText: "Remove", danger: true })) { const r = await run(supabase.from("hub_goal_items").delete().eq("id", i.id)); if (r.ok) goalItems.reload(); } };
  const checkIn = async () => {
    const r = await run(supabase.from("hub_goal_checkins").insert({ goal_id: g.id, status: ci.status, note: ci.note.trim() || null, value: g.measure === "number" && ci.value !== "" ? Number(ci.value) : null }), "Check-in saved");
    if (r.ok) { setCi({ ...ci, note: "", value: "" }); goals.reload(); const { data } = await supabase.from("hub_goal_checkins").select("*").eq("goal_id", g.id).order("at", { ascending: false }); setCheckins(data || []); }
  };
  const achieve = async (v) => { const r = await run(supabase.from("hub_goals").update({ achieved: v }).eq("id", g.id), v ? "Goal achieved 🏆" : "Reopened"); if (r.ok) goals.reload(); };
  const carry = async () => {
    const nf = nextFY(g.fy || currentFY());
    const row = { title: g.title, description: g.description, scope: g.scope, level: "goal", parent_id: g.parent_id, firm_id: g.firm_id, owner_id: g.owner_id, owner_name: g.owner_name, fy: nf, category: g.category,
      measure: g.measure, unit: g.unit, start_value: g.current_value ?? g.start_value, target_value: g.target_value, current_value: g.current_value, manual_pct: g.manual_pct, carried_from: g.id, target_date: fyEnd(nf) };
    const r = await run(supabase.from("hub_goals").insert(row).select(), `Copied to ${nf}`);
    if (r.ok) { const nid = r.data?.[0]?.id; for (const i of items.filter((x) => !x.done)) await supabase.from("hub_goal_items").insert({ goal_id: nid, text: i.text, owner_id: i.owner_id }); goals.reload(); goalItems.reload(); }
  };
  const del = async () => {
    if (!(await ask({ title: "Delete this goal?", body: `"${g.title}" will go to the recycle bin. Its tasks stay in the Task Manager.`, okText: "Delete", danger: true }))) return;
    const r = await run(supabase.from("hub_goals").update({ deleted_at: new Date().toISOString() }).eq("id", g.id), "Moved to recycle bin");
    if (r.ok) { goals.reload(); onClose(); }
  };
  const tasksOf = (mid) => gt.filter((t) => (mid ? t.milestone_id === mid : !t.milestone_id));
  const TaskLine = ({ t }) => {
    const due = t.status !== "Done" && t.due_date ? dueLabel(t.due_date) : null;
    return <div className={`gc-task ${t.status === "Done" ? "done" : ""}`} onClick={() => { window.location.hash = `tasks/${t.id}`; }}>
      <span>{t.status === "Done" ? "✅" : t.status === "Waiting" ? "⏳" : t.status === "In Progress" ? "🔵" : "⬜"}</span> {t.title}
      <span className="gc-task-m">{t.assignee_name}{due && <span className={`due ${due.cls}`}> · {due.text}</span>}</span></div>;
  };

  return (
    <Modal wide title={null} onClose={onClose}>
      <div className="gc-d">
        <div className="gc-d-head">
          <Ring pct={pct} size={78} color={g.achieved ? "#16a34a" : STATUS[g.status]?.c || "#2563eb"} />
          <div style={{ flex: 1 }}>
            <div className="gc-d-title">{g.firm_id && <span className="tk-firm" style={{ background: FIRM_COLORS[g.firm_id] }}>{g.firm_id}</span>}{g.title}</div>
            <div className="gc-sub">
              {personal ? <span>🔒 Private</span> : <span>🏢 Company</span>}
              {g.fy && <span>Year {g.fy}</span>}{g.category && <span>{g.category}</span>}
              {g.target_date && <span>🎯 by {fmtDate(g.target_date)}</span>}
              {g.owner_id && <span>👤 {people.find((p) => p.id === g.owner_id)?.full_name}</span>}
            </div>
            {exp !== null && !g.achieved && <div className="gc-plan">Time gone: {exp}% of the year · Progress: {pct}% {pct + 15 < exp ? <b className="chk-red"> — behind plan</b> : pct >= exp ? <b style={{ color: "#16a34a" }}> — ahead of plan</b> : ""}</div>}
          </div>
        </div>
        {g.description && <div className="tk-d-desc">{g.description}</div>}
        {g.measure === "number" && <div className="gc-num big">Now <b>{Number(g.current_value ?? g.start_value ?? 0).toLocaleString("en-IN")}</b> · target <b>{Number(g.target_value || 0).toLocaleString("en-IN")}</b> {g.unit} {g.start_value != null && <span className="small-muted">(started at {Number(g.start_value).toLocaleString("en-IN")})</span>}</div>}

        <div className="tk-d-box">
          <div className="tk-d-box-h">🏁 Milestones and tasks <span>{items.filter((i) => i.done).length}/{items.length}</span></div>
          {items.map((i) => (
            <div key={i.id} className={`gc-ms ${i.done ? "done" : ""}`}>
              <div className="gc-ms-row">
                <input type="checkbox" checked={i.done} onChange={() => toggleMs(i)} />
                <span className="gc-ms-t">{i.text}</span>
                {i.due_date && <span className={`due ${!i.done && daysUntil(i.due_date) < 0 ? "due-over" : ""}`}>📅 {fmtDate(i.due_date)}</span>}
                {i.owner_id && <Avatar name={people.find((p) => p.id === i.owner_id)?.full_name} size={20} />}
                <button className="mt-link" onClick={() => setTaskFor({ milestone: i })}>＋ Task</button>
                <button className="link-btn doc-del" onClick={() => delMs(i)}>✕</button>
              </div>
              {tasksOf(i.id).map((t) => <TaskLine key={t.id} t={t} />)}
            </div>
          ))}
          {tasksOf(null).length > 0 && <div className="gc-ms"><div className="gc-ms-row"><span className="gc-ms-t small-muted">Tasks not under a milestone</span></div>{tasksOf(null).map((t) => <TaskLine key={t.id} t={t} />)}</div>}
          <div className="gc-ms-add">
            <input className="inp" placeholder="Add a milestone, e.g. “Plant building completion certificate”" value={ms.text} onChange={(e) => setMs({ ...ms, text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addMs()} />
            <input className="inp inp-date" type="date" title="Milestone date" value={ms.due_date} onChange={(e) => setMs({ ...ms, due_date: e.target.value })} />
            {!personal && <select className="inp" style={{ width: 130 }} value={ms.owner_id} onChange={(e) => setMs({ ...ms, owner_id: e.target.value })}><option value="">Who?</option>{owners.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>}
            <button className="btn-ghost" onClick={addMs}>Add</button>
            <button className="btn-ghost" onClick={() => setTaskFor({})}>＋ Task</button>
          </div>
        </div>

        <div className="tk-d-box">
          <div className="tk-d-box-h">📝 Monthly check-in</div>
          <div className="gc-ci">
            <div className="gc-ci-btns">{Object.entries(STATUS).map(([k, v]) => <button key={k} className={ci.status === k ? "on" : ""} style={ci.status === k ? { background: v.c, borderColor: v.c } : {}} onClick={() => setCi({ ...ci, status: k })}>{v.i} {v.l}</button>)}</div>
            {g.measure === "number" && <input className="inp" style={{ width: 150 }} type="number" placeholder={`Now (${g.unit || "value"})`} value={ci.value} onChange={(e) => setCi({ ...ci, value: e.target.value })} />}
            <input className="inp" style={{ flex: 1, minWidth: 200 }} placeholder="One line: what moved, what is stuck" value={ci.note} onChange={(e) => setCi({ ...ci, note: e.target.value })} />
            <button className="btn-primary" onClick={checkIn}>Save</button>
          </div>
          <div className="gc-ci-list">
            {(checkins || []).map((c) => <div key={c.id}><span className="gc-dot" style={{ background: STATUS[c.status].c }} /> <b>{fmtDateTime(c.at)}</b> · {c.by_name} · {STATUS[c.status].l}{c.value != null && ` · ${Number(c.value).toLocaleString("en-IN")} ${g.unit || ""}`}{c.note && <> — {c.note}</>}</div>)}
            {checkins && checkins.length === 0 && <div className="small-muted">No check-ins yet. A reminder comes on the 1st of each month.</div>}
          </div>
        </div>

        {!personal && <div className="tk-d-box"><div className="tk-d-box-h">💬 Discussion</div><Comments type="goal" id={g.id} /></div>}

        <div className="tk-d-actions">
          <button className="btn-ghost" onClick={del}>🗑 Delete</button>
          {!g.achieved && <button className="btn-ghost" onClick={carry}>➡ Copy to next year</button>}
          <div style={{ flex: 1 }} />
          <button className="btn-ghost" onClick={onEdit}>✎ Edit</button>
          {g.achieved ? <button className="btn-ghost" onClick={() => achieve(false)}>Reopen</button> : <button className="btn-primary" style={{ background: "#16a34a" }} onClick={() => achieve(true)}>🏆 Mark achieved</button>}
        </div>
      </div>
      {taskFor && <TaskModal task={null} onClose={() => setTaskFor(null)} onSaved={tasks.reload}
        preset={{ title: taskFor.milestone ? taskFor.milestone.text : "", goal_id: g.id, milestone_id: taskFor.milestone?.id || null, firm_id: g.firm_id || "",
          due_date: taskFor.milestone?.due_date || "", assignee: personal ? me.id : taskFor.milestone?.owner_id || g.owner_id || "", personal, goalTitle: g.title }} />}
      {dialog}
    </Modal>
  );
}

// ── Add / edit ───────────────────────────────────────────────────────
function GoalModal({ goal, preset, visions, fy, onClose }) {
  const { goals, profiles, me } = useData();
  const scope = goal?.scope || preset.scope;
  const level = goal?.level || preset.level;
  const owners = profiles.rows.filter((p) => p.role === "owner" && p.status === "approved");
  const [f, setF] = useState(() => ({
    title: goal?.title || "", description: goal?.description || "", parent_id: goal?.parent_id || preset.parent_id || "",
    firm_id: goal?.firm_id || "", category: goal?.category || "", owner_id: goal?.owner_id || me.id, fy: goal?.fy || fy,
    target_date: goal?.target_date || (level === "goal" ? fyEnd(fy) : ""), measure: goal?.measure || "tasks", unit: goal?.unit || "",
    start_value: goal?.start_value ?? "", target_value: goal?.target_value ?? "", current_value: goal?.current_value ?? "", manual_pct: goal?.manual_pct ?? 0,
  }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (v) => (v === "" || v === null ? null : Number(v));
  const save = async () => {
    if (!f.title.trim()) { toast("Write the goal.", "err"); return; }
    if (level === "goal" && f.measure === "number" && f.target_value === "") { toast("Give the target number.", "err"); return; }
    const row = level === "vision"
      ? { title: f.title.trim(), description: f.description, scope, level, target_date: f.target_date || null }
      : { title: f.title.trim(), description: f.description, scope, level, parent_id: f.parent_id || null, firm_id: scope === "company" ? f.firm_id || null : null,
          category: f.category || null, owner_id: scope === "company" ? f.owner_id || null : me.id, owner_name: owners.find((p) => p.id === f.owner_id)?.full_name || me.full_name,
          fy: f.fy, target_date: f.target_date || null, measure: f.measure, unit: f.unit || null, start_value: num(f.start_value), target_value: num(f.target_value),
          current_value: num(f.current_value), manual_pct: f.measure === "manual" ? Number(f.manual_pct) || 0 : null };
    const r = await run(goal ? supabase.from("hub_goals").update(row).eq("id", goal.id) : supabase.from("hub_goals").insert(row), goal ? "Saved" : level === "vision" ? "Vision added" : "Goal added");
    if (r.ok) { goals.reload(); onClose(); }
  };
  const cats = scope === "company" ? CO_CATS : PE_CATS;
  const fys = [currentFY(), nextFY(currentFY()), nextFY(nextFY(currentFY()))];
  return (
    <Modal wide title={`${goal ? "Edit" : "New"} ${level === "vision" ? "long-term vision" : "goal"} ${scope === "personal" ? "🔒 (private)" : "🏢 (company)"}`} onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      <Field label={level === "vision" ? "Vision (3–5 years)" : "Goal for the year"}>
        <input className="form-inp" autoFocus value={f.title} onChange={set("title")} placeholder={level === "vision" ? (scope === "company" ? "e.g. Velite Sciences plant at full capacity by 2029" : "e.g. Fit and active at 60") : (scope === "company" ? "e.g. VH export sales ₹5 crore" : "e.g. Walk 8,000 steps a day")} />
      </Field>
      <Field label="Why it matters / details (optional)"><textarea className="form-inp" rows={2} value={f.description} onChange={set("description")} /></Field>
      {level === "vision" ? (
        <Field label="Target year (optional)"><input className="form-inp" type="date" value={f.target_date} onChange={set("target_date")} /></Field>
      ) : (
        <>
          <div className="form-grid">
            <Field label="Under which vision"><select className="form-inp" value={f.parent_id} onChange={set("parent_id")}><option value="">— none —</option>{visions.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></Field>
            <Field label="Year"><select className="form-inp" value={f.fy} onChange={set("fy")}>{fys.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Target date"><input className="form-inp" type="date" value={f.target_date} onChange={set("target_date")} /></Field>
          </div>
          <div className="form-grid">
            {scope === "company" && <Field label="Firm"><select className="form-inp" value={f.firm_id} onChange={set("firm_id")}><option value="">Group / all firms</option>{FIRMS.map((x) => <option key={x}>{x}</option>)}</select></Field>}
            <Field label="Area"><select className="form-inp" value={f.category} onChange={set("category")}><option value="">—</option>{cats.map((x) => <option key={x}>{x}</option>)}</select></Field>
            {scope === "company" && <Field label="Goal owner"><select className="form-inp" value={f.owner_id} onChange={set("owner_id")}>{owners.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>}
          </div>
          <Field label="How is progress measured?"><select className="form-inp" value={f.measure} onChange={set("measure")}>{MEASURES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {f.measure === "number" && (
            <div className="form-grid">
              <Field label="Unit"><input className="form-inp" value={f.unit} onChange={set("unit")} placeholder="₹ crore / countries / kg" /></Field>
              <Field label="Starting value"><input className="form-inp" type="number" value={f.start_value} onChange={set("start_value")} /></Field>
              <Field label="Target"><input className="form-inp" type="number" value={f.target_value} onChange={set("target_value")} /></Field>
              <Field label="Now"><input className="form-inp" type="number" value={f.current_value} onChange={set("current_value")} /></Field>
            </div>
          )}
          {f.measure === "manual" && <Field label={`Progress: ${f.manual_pct}%`}><input type="range" min="0" max="100" step="5" value={f.manual_pct} onChange={set("manual_pct")} style={{ width: "100%" }} /></Field>}
        </>
      )}
    </Modal>
  );
}
