import { useState } from "react";
import { supabase } from "../../supabase";
import { useData, run, toast } from "../../lib/data";
import { Modal, Field, SearchBox } from "../../components/ui";
import { todayISO, addDaysISO } from "../../lib/dates";
import { Pill } from "../ipr/shared";
import { applicability, ruleText, regenerate } from "./common";
import { LibInfo } from "./ItemModal";

export default function Library() {
  const d = useData();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [openCode, setOpenCode] = useState(null);
  const [setup, setSetup] = useState(null);
  const [event, setEvent] = useState(null);
  const depts = [...new Set(d.cmpLib.rows.map((l) => l.dept))];
  const s = q.trim().toLowerCase();
  const list = d.cmpLib.rows.filter((l) => l.active && (dept === "all" || l.dept === dept) &&
    (!s || `${l.code} ${l.title} ${l.what} ${l.law} ${l.form}`.toLowerCase().includes(s)));

  return (
    <div className="ipanel">
      <div className="ipanel-head"><div><h3>Compliance library — {d.cmpLib.rows.length} obligations</h3>
        <p>Researched November 2026 with sources. Green = applies to that firm. Click an item for details, who is responsible, or to start an event-based item.</p></div></div>
      <div className="filter-bar" style={{ marginBottom: 10 }}>
        <select className="inp inp-filter" value={dept} onChange={(e) => setDept(e.target.value)}><option value="all">All departments</option>{depts.map((x) => <option key={x}>{x}</option>)}</select>
        <SearchBox value={q} onChange={setQ} placeholder="Search law, form, topic…" />
      </div>
      {depts.filter((x) => list.some((l) => l.dept === x)).map((dep) => (
        <div key={dep} className="cmp-month">
          <div className="day-block-title">{dep}</div>
          {list.filter((l) => l.dept === dep).map((l) => (
            <div key={l.code} className="cmp-lib">
              <div className="cmp-lib-head" onClick={() => setOpenCode(openCode === l.code ? null : l.code)}>
                <span className="small-muted cmp-code">{l.code}</span>
                <span className="cmp-title"><b>{l.title}</b><div className="small-muted">{ruleText(l.rule)}</div></span>
                <span className="cmp-chips">{d.cmpFirms.rows.map((f) => { const a = applicability(f, l, d.cmpAssign.rows); return (
                  <Pill key={f.id} tone={a.applies ? "green" : ""} title={a.mode !== "auto" ? "Set by owner" : "Automatic from firm settings"}>{f.id}{a.mode !== "auto" ? "*" : ""}</Pill>); })}</span>
              </div>
              {openCode === l.code && (
                <div className="cmp-lib-body">
                  <LibInfo lib={l} />
                  <div className="flex-between" style={{ gap: 8, flexWrap: "wrap" }}>
                    {l.rule?.t === "event" && <button className="btn-primary" onClick={() => setEvent(l)}>▶ It happened — create item</button>}
                    {d.isOwner && <button className="btn-ghost" onClick={() => setSetup(l)}>⚙ Who does it / applies to which firm</button>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      {setup && <SetupModal lib={setup} onClose={() => setSetup(null)} />}
      {event && <EventModal lib={event} onClose={() => setEvent(null)} />}
    </div>
  );
}

function SetupModal({ lib, onClose }) {
  const d = useData();
  const people = d.profiles.rows.filter((p) => p.status === "approved");
  const [rows, setRows] = useState(() => d.cmpFirms.rows.map((f) => {
    const a = applicability(f, lib, d.cmpAssign.rows);
    return { firm_id: f.id, auto: a.auto, mode: a.mode, na_reason: a.assign?.na_reason || "", owner_id: a.assign?.owner_id || "", checker_id: a.assign?.checker_id || "", owner_ext: a.assign?.owner_ext || "" };
  }));
  const [applyOpen, setApplyOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const upd = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    for (const r of rows) if (r.mode === "no" && r.auto && !r.na_reason.trim()) { toast(`Give a reason why it does not apply to ${r.firm_id}.`, "err"); return; }
    setBusy(true);
    const payload = rows.map((r) => ({ firm_id: r.firm_id, code: lib.code, mode: r.mode, na_reason: r.na_reason.trim() || null,
      owner_id: r.owner_id || null, checker_id: r.checker_id || null, owner_ext: r.owner_ext.trim() || null, updated_at: new Date().toISOString() }));
    const res = await run(supabase.from("hub_cmp_assign").upsert(payload, { onConflict: "firm_id,code" }));
    if (res.ok && applyOpen) {
      for (const r of rows) {
        await supabase.from("hub_cmp_items").update({ owner_id: r.owner_id || null, checker_id: r.checker_id || null })
          .eq("firm_id", r.firm_id).eq("code", lib.code).in("status", ["pending", "in_progress"]);
      }
    }
    if (res.ok) { await regenerate(true); toast("Saved"); d.cmpAssign.reload(); d.cmpItems.reload(); onClose(); }
    setBusy(false);
  };
  return (
    <Modal wide title={`${lib.code} · ${lib.title}`} onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Firm</th><th>Applies?</th><th>Responsible</th><th>Checker</th><th>Outside party (CA/CS)</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.firm_id}>
            <td><b>{r.firm_id}</b><div className="small-muted">auto: {r.auto ? "yes" : "no"}</div></td>
            <td><select className="inp" value={r.mode} onChange={(e) => upd(i, "mode", e.target.value)}>
              <option value="auto">Automatic ({r.auto ? "yes" : "no"})</option><option value="yes">Yes, applies</option><option value="no">No, not applicable</option></select>
              {r.mode === "no" && <input className="inp" style={{ marginTop: 4 }} placeholder="Reason (required)" value={r.na_reason} onChange={(e) => upd(i, "na_reason", e.target.value)} />}</td>
            <td><select className="inp" value={r.owner_id} onChange={(e) => upd(i, "owner_id", e.target.value)}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></td>
            <td><select className="inp" value={r.checker_id} onChange={(e) => upd(i, "checker_id", e.target.value)}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></td>
            <td><input className="inp" placeholder="e.g. CA Gupta & Co." value={r.owner_ext} onChange={(e) => upd(i, "owner_ext", e.target.value)} /></td>
          </tr>))}</tbody>
      </table></div>
      <label className="small-muted"><input type="checkbox" checked={applyOpen} onChange={(e) => setApplyOpen(e.target.checked)} /> Also apply responsible/checker to items already open</label>
    </Modal>
  );
}

function EventModal({ lib, onClose }) {
  const d = useData();
  const firms = d.cmpFirms.rows.filter((f) => applicability(f, lib, d.cmpAssign.rows).applies);
  const [firm, setFirm] = useState(firms[0]?.id || d.cmpFirms.rows[0]?.id);
  const [date, setDate] = useState(todayISO());
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const off = lib.rule?.offset || 0;
  const due = addDaysISO(date, off);
  const save = async () => {
    if (!label.trim()) { toast("Describe what happened (e.g. 'New QC chemist joined').", "err"); return; }
    setBusy(true);
    const a = d.cmpAssign.rows.find((x) => x.firm_id === firm && x.code === lib.code);
    const r = await run(supabase.from("hub_cmp_items").insert({ firm_id: firm, code: lib.code, period_key: `E:${Date.now()}`, period_label: label.trim(),
      due_date: due, manual: true, owner_id: a?.owner_id || null, checker_id: a?.checker_id || null }), "Item created");
    setBusy(false);
    if (r.ok) { d.cmpItems.reload(); onClose(); }
  };
  return (
    <Modal title={lib.title} onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>Create</button></>}>
      <Field label="Firm"><select className="inp" value={firm} onChange={(e) => setFirm(e.target.value)}>{d.cmpFirms.rows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
      <Field label="What happened?"><input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. New product 'Acne gel' / director changed" /></Field>
      <Field label={off < 0 ? "Planned date of the event" : "Date it happened"}><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="small-muted">Due date will be <b>{due}</b> ({ruleText(lib.rule)}).</div>
    </Modal>
  );
}
