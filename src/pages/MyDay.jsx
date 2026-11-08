import { useState } from "react";
import { supabase } from "../supabase";
import { useData, run } from "../lib/data";
import { daysUntil, timeAgo, dueLabel } from "../lib/dates";
import { isMine, byDue, TaskCard, TaskModal } from "./Tasks";
import { materialsSummary } from "./Materials";
import { goalProgress } from "./Compass";
import { tmDue } from "./Trademarks";
import { fmtDate } from "../lib/dates";
import { Empty } from "../components/ui";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function myAlerts(tasks, me) {
  const mine = tasks.rows.filter((t) => !t.deleted_at && t.status !== "Done" && isMine(t, me));
  return mine.filter((t) => t.due_date && daysUntil(t.due_date) <= 0).length;
}

// Owners see every open compliance item; others see only items where they are maker or checker
const cmpOpen = (i) => !i.deleted_at && (i.status === "pending" || i.status === "in_progress");
export function cmpAlerts(cmpItems, me) {
  return cmpItems.rows.filter((i) => cmpOpen(i) && (i.owner_id === me.id || i.checker_id === me.id) && daysUntil(i.due_date) <= 0).length;
}

export default function MyDay({ go }) {
  const { me, isOwner, tasks, materials, comments, goals, goalItems, trademarks, cmpItems, cmpLib } = useData();
  const [edit, setEdit] = useState(null);

  const open = tasks.rows.filter((t) => !t.deleted_at && t.status !== "Done");
  const mine = open.filter((t) => isMine(t, me)).sort(byDue);
  const overdue = mine.filter((t) => t.due_date && daysUntil(t.due_date) < 0);
  const today = mine.filter((t) => t.due_date && daysUntil(t.due_date) === 0);
  const week = mine.filter((t) => t.due_date && daysUntil(t.due_date) > 0 && daysUntil(t.due_date) <= 7);
  const noDate = mine.filter((t) => !t.due_date);
  const later = mine.filter((t) => t.due_date && daysUntil(t.due_date) > 7);
  const mat = materialsSummary(materials.rows);

  // comments by others in the last 7 days on things I own / am assigned
  const myTaskIds = new Set(tasks.rows.filter((t) => isMine(t, me) || t.created_by === me.id).map((t) => t.id));
  const myMatIds = new Set(materials.rows.filter((m) => m.created_by === me.id).map((m) => m.id));
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = comments.rows.filter((c) => !c.deleted_at && c.author_id !== me.id && new Date(c.created_at).getTime() > weekAgo &&
    ((c.entity_type === "task" && myTaskIds.has(c.entity_id)) || (c.entity_type === "material" && myMatIds.has(c.entity_id))))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 8);
  const titleOf = (c) => c.entity_type === "task"
    ? tasks.rows.find((t) => t.id === c.entity_id)?.title
    : materials.rows.find((m) => m.id === c.entity_id)?.name;

  const setStatus = async (t, status) => { const r = await run(supabase.from("hub_tasks").update({ status }).eq("id", t.id), status === "Done" ? "Task completed ✅" : null); if (r.ok) tasks.reload(); };

  const teamOverdue = open.filter((t) => t.due_date && daysUntil(t.due_date) < 0);
  const byPerson = {};
  open.forEach((t) => { const k = t.assignee_name || "Unassigned"; byPerson[k] = byPerson[k] || { open: 0, over: 0 }; byPerson[k].open++; if (t.due_date && daysUntil(t.due_date) < 0) byPerson[k].over++; });

  const block = (title, list, tone) => list.length > 0 && (
    <div className={`day-block ${tone || ""}`}>
      <div className="day-block-title">{title} <span className="section-count">{list.length}</span></div>
      {list.map((t) => <TaskCard key={t.id} t={t} compact onStatus={(s) => setStatus(t, s)} />)}
    </div>
  );

  return (
    <div>
      <div className="hello">
        <div>
          <div className="hello-title">{greeting()}, {me.full_name} 👋</div>
          <div className="hello-sub">
            {overdue.length ? <span className="due-over">{overdue.length} overdue</span> : <span>Nothing overdue</span>}
            {" · "}{today.length} due today · {week.length} due this week
          </div>
        </div>
        <button className="add-btn" onClick={() => setEdit({})}>+ New Task</button>
      </div>

      <div className="day-grid">
        <div className="section day-main">
          <div className="section-head"><div className="section-title">📋 My tasks</div>
            <button className="link-btn strong" onClick={() => go("tasks")}>All tasks →</button></div>
          <div className="task-cards-area">
            {mine.length === 0 && <Empty>No open tasks assigned to you. 🎉</Empty>}
            {block("⚠️ Overdue", overdue, "tone-red")}
            {block("Today", today, "tone-amber")}
            {block("This week", week)}
            {block("Later", later)}
            {block("No due date", noDate, "tone-muted")}
          </div>
        </div>

        <div className="day-side">
          <div className="section">
            <div className="section-head"><div className="section-title">📦 Materials</div>
              <button className="link-btn strong" onClick={() => go("materials")}>Open →</button></div>
            <div className="stat-row">
              <div className="stat"><div className="stat-n">{mat.rmPending}</div><div className="stat-l">Raw pending</div></div>
              <div className="stat"><div className="stat-n">{mat.pmPending}</div><div className="stat-l">Packing pending</div></div>
              <div className="stat"><div className="stat-n">{mat.ordered}</div><div className="stat-l">Awaiting receipt</div></div>
            </div>
            {mat.hot.length > 0 && (
              <div className="side-list">
                {mat.hot.slice(0, 6).map((m) => {
                  const d = m.required_by ? dueLabel(m.required_by) : null;
                  return <div key={m.id} className="side-item">
                    {m.urgent && <span className="urgent">URGENT</span>}{m.name}
                    {d && <span className={`due ${d.cls}`}> {d.text}</span>}
                    <span className="small-muted"> · {m.status}</span>
                  </div>;
                })}
              </div>
            )}
          </div>

          <div className="section">
            <div className="section-head"><div className="section-title">💬 New comments on my items</div></div>
            <div className="side-list">
              {recent.length === 0 && <div className="small-muted">No new comments this week.</div>}
              {recent.map((c) => (
                <div key={c.id} className="side-item">
                  <strong>{c.author_name}</strong> on <em>{titleOf(c) || "an item"}</em>: {c.body}
                  <div className="small-muted">{timeAgo(c.created_at)}</div>
                </div>
              ))}
            </div>
          </div>

          {(() => {
            const tms = trademarks.rows.filter((t) => !t.deleted_at && tmDue(t) && tmDue(t).n <= 180).sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
            return (
              <div className="section">
                <div className="section-head"><div className="section-title">⚖️ Trademark deadlines</div>
                  <button className="link-btn strong" onClick={() => go("ipr")}>Open →</button></div>
                <div className="side-list">
                  {tms.length === 0 && <div className="small-muted">No trademark deadlines in the next 6 months.</div>}
                  {tms.slice(0, 6).map((t) => { const d = tmDue(t); return (
                    <div key={t.id} className="side-item flex-between"><span><strong>{t.mark}</strong> <span className="small-muted">· {t.status}</span></span>
                      <span className={`due ${d.cls}`}>{fmtDate(t.deadline)}{d.text ? ` · ${d.text}` : ""}</span></div>); })}
                </div>
              </div>
            );
          })()}

          {(() => {
            const list = cmpItems.rows.filter((i) => cmpOpen(i) && daysUntil(i.due_date) <= 15 &&
              (isOwner || i.owner_id === me.id || i.checker_id === me.id));
            const toCheck = cmpItems.rows.filter((i) => !i.deleted_at && i.status === "filed" && (i.checker_id === me.id || (isOwner && !i.checker_id)));
            const late = list.filter((i) => daysUntil(i.due_date) < 0).length;
            return (
              <div className="section">
                <div className="section-head"><div className="section-title">🛡️ Compliance — next 15 days</div>
                  <button className="link-btn strong" onClick={() => go("compliance")}>Open →</button></div>
                <div className="side-list">
                  <div className="small-muted" style={{ marginBottom: 6 }}>{list.length} due{late ? <span className="due-over"> · {late} overdue</span> : ""}{toCheck.length ? ` · ${toCheck.length} filed, waiting for your check` : ""}</div>
                  {list.length === 0 && <div className="small-muted">Nothing due in the next 15 days.</div>}
                  {list.slice(0, 8).map((i) => { const d = dueLabel(i.due_date); const l = cmpLib.rows.find((x) => x.code === i.code); return (
                    <div key={i.id} className="side-item flex-between"><span><strong>{i.firm_id}</strong> · {l?.title || i.code} <span className="small-muted">· {i.period_label}</span></span>
                      <span className={`due ${d.cls}`}>{d.text}</span></div>); })}
                  {list.length > 8 && <div className="small-muted">+{list.length - 8} more</div>}
                </div>
              </div>
            );
          })()}

          {isOwner && (
            <div className="section">
              <div className="section-head"><div className="section-title">👥 Team at a glance</div></div>
              <div className="side-list">
                <div className="small-muted" style={{ marginBottom: 6 }}>{open.length} open tasks · <span className={teamOverdue.length ? "due-over" : ""}>{teamOverdue.length} overdue</span></div>
                {Object.entries(byPerson).sort((a, b) => b[1].over - a[1].over || b[1].open - a[1].open).map(([k, v]) => (
                  <div key={k} className="side-item flex-between"><span>{k}</span><span>{v.open} open{v.over ? <span className="due-over"> · {v.over} overdue</span> : ""}</span></div>
                ))}
                {goals.rows.filter((g) => !g.deleted_at && !g.achieved).length > 0 && <div className="day-block-title" style={{ marginTop: 10 }}>Goals</div>}
                {goals.rows.filter((g) => !g.deleted_at && !g.achieved).map((g) => (
                  <div key={g.id} className="side-item flex-between"><span>{g.title}</span><span>{goalProgress(goalItems.rows.filter((i) => i.goal_id === g.id))}%</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {edit && <TaskModal task={null} onClose={() => setEdit(null)} onSaved={tasks.reload} />}
    </div>
  );
}
