import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { Modal, Field, Empty, useConfirm } from "../components/ui";
import { fmtD, todayISO, addDays } from "../lib/qc";

// Daily Report: every person writes a short end-of-day note. Owners see the team view and can change the questions.
// The questions live in hub_report_fields; each saved report keeps a copy of the question text, so changing the format never garbles old reports.

const KINDS = { long: "Long answer", text: "Short answer", number: "Number", yesno: "Yes / No", choice: "Pick one" };
const dayName = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long" });
const shortDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

function useFields() {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true);
  const load = async () => { const { data } = await supabase.from("hub_report_fields").select("*").order("position"); setRows(data || []); setLoading(false); };
  useEffect(() => { load(); }, []);
  return { rows, loading, reload: load };
}

export default function DailyReport() {
  const { isOwner } = useData();
  const [view, setView] = useState("mine");
  const fields = useFields();
  return (
    <div className="section qcp">
      <div className="mt-hero dr-hero">
        <div><div className="mt-hero-title">📝 Daily Report</div>
          <div className="mt-hero-sub">A short note at the end of each working day: what was done, what is stuck, what is next</div></div>
      </div>
      <div className="tk-views qc-tabs">
        {[["mine", "✍️ My report"], ...(isOwner ? [["team", "👥 Team"], ["format", "⚙️ Format"]] : [])].map(([k, l]) => (
          <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>))}
      </div>
      {fields.loading ? <div className="loading">Loading…</div> : view === "mine" ? <MyReport fields={fields.rows.filter((f) => f.active)} />
        : view === "team" ? <Team /> : <Format fields={fields.rows} reload={fields.reload} />}
    </div>
  );
}

// ── my report ────────────────────────────────────────────────────────────
function MyReport({ fields }) {
  const { me } = useData();
  const today = todayISO();
  const days = [today, addDays(today, -1), addDays(today, -2), addDays(today, -3)];
  const [date, setDate] = useState(today);
  const [mine, setMine] = useState([]);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const load = async () => { const { data } = await supabase.from("hub_daily_reports").select("*").eq("user_id", me.id).order("report_date", { ascending: false }).limit(30); setMine(data || []); };
  useEffect(() => { load(); }, []); // eslint-disable-line
  const current = mine.find((r) => r.report_date === date);
  useEffect(() => { // fill the boxes from what was saved
    const v = {}; (current?.answers || []).forEach((a) => { v[a.id] = a.value ?? ""; }); setVals(v);
  }, [date, current?.id, current?.updated_at]); // eslint-disable-line
  const set = (id, v) => setVals((x) => ({ ...x, [id]: v }));

  const save = async () => {
    const missing = fields.filter((f) => f.required && !String(vals[f.id] ?? "").trim());
    if (missing.length) { toast(`Please answer: ${missing[0].label}`, "err"); return; }
    setBusy(true);
    const answers = fields.map((f) => ({ id: f.id, label: f.label, kind: f.kind, value: String(vals[f.id] ?? "").trim() })).filter((a) => a.value !== "");
    const r = await run(supabase.from("hub_daily_reports").upsert({ user_id: me.id, report_date: date, answers }, { onConflict: "user_id,report_date" }), current ? "Report updated" : "Report submitted. Thank you!");
    setBusy(false);
    if (r.ok) load();
  };

  return (
    <>
      <div className="seg" style={{ marginBottom: 12 }}>
        {days.map((d) => { const done = mine.some((r) => r.report_date === d);
          return <button key={d} className={date === d ? "on" : ""} onClick={() => setDate(d)}>{d === today ? "Today" : shortDay(d)} {done ? "✓" : ""}</button>; })}
      </div>
      <div className="ipanel">
        <div className="ipanel-head"><div><h3>{dayName(date)}, {fmtD(date)}</h3>
          <p>{current ? `Submitted. You can still change it until ${fmtD(addDays(date, 3))}.` : "Not submitted yet. It takes about a minute."}</p></div></div>
        {fields.length === 0 && <Empty>No questions are set yet. Ask an owner to add them.</Empty>}
        {fields.map((f) => (
          <Field key={f.id} label={`${f.label}${f.required ? " *" : ""}`} hint={f.hint || undefined}>
            {f.kind === "long" ? <textarea className="form-inp" rows={3} value={vals[f.id] || ""} onChange={(e) => set(f.id, e.target.value)} />
              : f.kind === "number" ? <input className="form-inp" type="number" value={vals[f.id] || ""} onChange={(e) => set(f.id, e.target.value)} />
              : f.kind === "yesno" ? <div className="seg">{["Yes", "No"].map((o) => <button key={o} type="button" className={vals[f.id] === o ? "on" : ""} onClick={() => set(f.id, vals[f.id] === o ? "" : o)}>{o}</button>)}</div>
              : f.kind === "choice" ? <select className="form-inp" value={vals[f.id] || ""} onChange={(e) => set(f.id, e.target.value)}><option value="">Choose…</option>{(f.options || []).map((o) => <option key={o}>{o}</option>)}</select>
              : <input className="form-inp" value={vals[f.id] || ""} onChange={(e) => set(f.id, e.target.value)} />}
          </Field>))}
        {fields.length > 0 && <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : current ? "Update report" : "Submit report"}</button>}
      </div>
      {mine.length > 0 && (
        <div className="ipanel"><div className="ipanel-head"><div><h3>My earlier reports</h3></div></div>
          {mine.filter((r) => !days.includes(r.report_date)).slice(0, 10).map((r) => <Answers key={r.id} title={`${dayName(r.report_date)}, ${fmtD(r.report_date)}`} answers={r.answers} />)}
          {mine.filter((r) => !days.includes(r.report_date)).length === 0 && <Empty>Older reports will appear here.</Empty>}
        </div>)}
    </>
  );
}

function Answers({ title, answers }) {
  return (
    <div className="dr-ans">{title && <b>{title}</b>}
      {(answers || []).length === 0 ? <div className="small-muted">No answers.</div> : answers.map((a) => <div key={a.id}><span className="small-muted">{a.label}</span><div>{a.value}</div></div>)}</div>
  );
}

// ── team (owners) ────────────────────────────────────────────────────────
function Team() {
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState(null);
  const [week, setWeek] = useState({});
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true; setRows(null); setErr("");
    supabase.rpc("hub_daily_overview", { p_date: date }).then(({ data, error }) => { if (!live) return; if (error) setErr(error.message); else setRows(data); });
    return () => { live = false; };
  }, [date]);
  useEffect(() => { // who wrote a report on each of the last 7 days
    const from = addDays(today, -6);
    supabase.from("hub_daily_reports").select("user_id,report_date").gte("report_date", from).then(({ data }) => {
      const m = {}; (data || []).forEach((r) => { (m[r.user_id] ||= new Set()).add(r.report_date); }); setWeek(m);
    });
  }, [date, today]);
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));
  const expected = useMemo(() => (rows || []).filter((r) => r.role !== "owner" || r.submitted_at), [rows]);
  const sent = expected.filter((r) => r.submitted_at);
  const missing = expected.filter((r) => !r.submitted_at);
  const sum = (k) => (rows || []).reduce((a, r) => a + (r[k] || 0), 0);
  const stuck = sent.filter((r) => (r.answers || []).some((a) => /stuck|help|problem/i.test(a.label) && a.value && !/^(nothing|nil|no|none|na|n\/a|-)\.?$/i.test(a.value.trim())));

  if (err) return <div className="mt-dup">{err}</div>;
  if (!rows) return <div className="loading">Loading…</div>;
  return (
    <>
      <div className="dr-nav">
        <button className="btn-ghost sm" onClick={() => setDate(addDays(date, -1))}>◀</button>
        <input className="form-inp" type="date" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ maxWidth: 170 }} />
        <button className="btn-ghost sm" onClick={() => setDate(addDays(date, 1))} disabled={date >= today}>▶</button>
        <b>{dayName(date)}</b>{date !== today && <button className="btn-ghost sm" onClick={() => setDate(today)}>Today</button>}
      </div>
      <div className="mt-kpis" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <div className="mt-kpi green"><b>{sent.length} of {expected.length}</b><span>reports submitted</span></div>
        <div className="mt-kpi amber"><b>{stuck.length}</b><span>say they are stuck</span></div>
        <div className="mt-kpi blue"><b>{sum("tasks_done")}</b><span>tasks completed</span></div>
        <div className="mt-kpi rose"><b>{sum("tasks_overdue")}</b><span>tasks overdue (all open)</span></div>
      </div>
      {missing.length > 0 && <div className="mt-dup" style={{ marginTop: 10 }}>⏳ No report yet: {missing.map((r) => r.full_name).join(", ")}</div>}
      {stuck.length > 0 && (
        <div className="ipanel"><div className="ipanel-head"><div><h3>🆘 Stuck or need help</h3></div></div>
          {stuck.map((r) => { const a = r.answers.find((x) => /stuck|help|problem/i.test(x.label)); return <div key={r.user_id} className="qc-row"><span className="qc-row-main"><b>{r.full_name}</b><small>{a.value}</small></span></div>; })}
        </div>)}
      <div className="ipanel">
        <div className="ipanel-head"><div><h3>Everyone</h3><p>Press a name to read the report. “Hub activity” is what the Hub saw them do that day, so it also works as a cross-check.</p></div></div>
        <div className="table-wrap"><table className="tbl dr-tbl">
          <thead><tr><th>Name</th><th>Report</th><th>Hub activity</th><th>Open tasks</th><th>Last 7 days</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const isExp = r.role !== "owner" || r.submitted_at; const activity = [r.tasks_done && `${r.tasks_done} task${r.tasks_done > 1 ? "s" : ""} done`, r.qc_entries && `${r.qc_entries} QC`, r.batches_entered && `${r.batches_entered} batch${r.batches_entered > 1 ? "es" : ""}`].filter(Boolean).join(" · ");
              return (
                <Fragment key={r.user_id}>
                  <tr className="qc-tr" onClick={() => setOpen(open === r.user_id ? null : r.user_id)}>
                    <td><b>{r.full_name}</b>{r.role === "owner" && <small className="qc-sub"> owner</small>}</td>
                    <td>{r.submitted_at ? <span className="qc-pill" style={{ background: "#16a34a" }}>✓ {new Date(r.submitted_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span> : isExp ? <span className="qc-pill" style={{ background: "#d97706" }}>Not yet</span> : <span className="small-muted">—</span>}</td>
                    <td>{activity || <span className="small-muted">{r.other_actions ? `${r.other_actions} other action${r.other_actions > 1 ? "s" : ""}` : "none seen"}</span>}</td>
                    <td>{r.tasks_open}{r.tasks_overdue > 0 && <span className="due-over"> · {r.tasks_overdue} overdue</span>}</td>
                    <td className="nowrap">{last7.map((d) => <span key={d} title={shortDay(d)} className={`dr-dot ${week[r.user_id]?.has(d) ? "on" : ""}`} />)}</td>
                  </tr>
                  {open === r.user_id && <tr><td colSpan={5}>{r.submitted_at ? <Answers answers={r.answers} /> : <div className="small-muted">No report for this day.</div>}</td></tr>}
                </Fragment>);
            })}
          </tbody></table></div>
      </div>
      <div className="small-muted" style={{ marginTop: 6 }}>Owners are listed but not expected to write a report. Work done outside the Hub (on the floor, on paper) does not show under Hub activity.</div>
    </>
  );
}

// ── format (owners) ──────────────────────────────────────────────────────
function Format({ fields, reload }) {
  const [edit, setEdit] = useState(null);
  const [ask, dialog] = useConfirm();
  const move = async (f, dir) => {
    const list = fields.slice().sort((a, b) => a.position - b.position); const i = list.findIndex((x) => x.id === f.id); const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[i], b = list[j];
    await supabase.from("hub_report_fields").update({ position: b.position === a.position ? b.position + dir : b.position }).eq("id", a.id);
    await supabase.from("hub_report_fields").update({ position: a.position }).eq("id", b.id);
    reload();
  };
  const toggle = async (f) => { const r = await run(supabase.from("hub_report_fields").update({ active: !f.active }).eq("id", f.id), f.active ? "Question hidden" : "Question back in the report"); if (r.ok) reload(); };
  const remove = async (f) => {
    if (!(await ask({ title: "Delete this question?", body: `“${f.label}” will no longer be asked. Reports already written keep their answers. Hiding is gentler: you can bring it back.`, okText: "Delete", danger: true }))) return;
    const r = await run(supabase.from("hub_report_fields").delete().eq("id", f.id), "Deleted"); if (r.ok) reload();
  };
  const sorted = fields.slice().sort((a, b) => a.position - b.position);
  return (
    <div className="ipanel">
      <div className="ipanel-head"><div><h3>⚙️ Questions in the daily report</h3><p>This is what everyone sees on the Daily Report screen. Changes apply from the next time someone opens it. Old reports keep the wording they were written with.</p></div>
        <button className="btn-primary sm" onClick={() => setEdit({})}>＋ Add a question</button></div>
      {sorted.map((f, i) => (
        <div key={f.id} className={`qc-row ${f.active ? "" : "row-off"}`}>
          <span className="qc-row-main"><b>{i + 1}. {f.label}{f.required ? " *" : ""}</b><small>{KINDS[f.kind]}{f.kind === "choice" ? `: ${(f.options || []).join(", ")}` : ""}{f.hint ? ` · ${f.hint}` : ""}{f.active ? "" : " · hidden"}</small></span>
          <button className="icon-btn" onClick={() => move(f, -1)} disabled={i === 0} title="Move up">↑</button>
          <button className="icon-btn" onClick={() => move(f, 1)} disabled={i === sorted.length - 1} title="Move down">↓</button>
          <button className="btn-ghost sm" onClick={() => setEdit(f)}>Edit</button>
          <button className="btn-ghost sm" onClick={() => toggle(f)}>{f.active ? "Hide" : "Show"}</button>
          <button className="btn-ghost sm" onClick={() => remove(f)}>Delete</button>
        </div>))}
      {sorted.length === 0 && <Empty>No questions. Add one to start.</Empty>}
      <div className="small-muted" style={{ marginTop: 8 }}>* means the person must answer it before submitting.</div>
      {edit && <FieldForm f={edit} count={fields.length} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {dialog}
    </div>
  );
}

function FieldForm({ f, count, onClose, onSaved }) {
  const isNew = !f.id;
  const [v, setV] = useState({ label: f.label || "", hint: f.hint || "", kind: f.kind || "long", options: (f.options || []).join(", "), required: !!f.required });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!v.label.trim()) { toast("Write the question.", "err"); return; }
    const options = v.kind === "choice" ? v.options.split(",").map((x) => x.trim()).filter(Boolean) : [];
    if (v.kind === "choice" && options.length < 2) { toast("Give at least two choices, separated by commas.", "err"); return; }
    setBusy(true);
    const row = { label: v.label.trim(), hint: v.hint.trim() || null, kind: v.kind, options, required: v.required };
    const r = isNew ? await run(supabase.from("hub_report_fields").insert({ ...row, position: (count + 1) * 10 }), "Question added") : await run(supabase.from("hub_report_fields").update(row).eq("id", f.id), "Saved");
    setBusy(false); if (r.ok) onSaved();
  };
  return (
    <Modal title={isNew ? "New question" : "Edit question"} onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <Field label="Question"><input className="form-inp" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="For example: Any sample or material pending with you?" /></Field>
      <Field label="Help text (optional)" hint="Shown under the question, in small grey letters."><input className="form-inp" value={v.hint} onChange={(e) => setV({ ...v, hint: e.target.value })} /></Field>
      <Field label="Type of answer"><select className="form-inp" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {v.kind === "choice" && <Field label="Choices" hint="Separate with commas, for example: Good, Average, Poor"><input className="form-inp" value={v.options} onChange={(e) => setV({ ...v, options: e.target.value })} /></Field>}
      <label className="chk"><input type="checkbox" checked={v.required} onChange={(e) => setV({ ...v, required: e.target.checked })} /> The person must answer this before submitting</label>
    </Modal>
  );
}
