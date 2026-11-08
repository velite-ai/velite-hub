import { useEffect, useState } from "react";
import { fmtDateTime } from "../../lib/dates";
import { supabase } from "../../supabase";
import { useData, run } from "../../lib/data";
import { Field } from "../../components/ui";
import { FLAGS, FLAG_GROUPS, regenerate, evalApplies } from "./common";

export default function Firms() {
  const d = useData();
  return (
    <>
      <EmailPanel />
      <div className="cmp-alert">Tick what is true for each firm. The tracker uses these answers to decide which of the {d.cmpLib.rows.length} compliances apply. When unsure, leave it ticked — an item can always be marked “Not applicable” with a reason.</div>
      {d.cmpFirms.rows.map((f) => <FirmCard key={f.id} firm={f} />)}
    </>
  );
}

function FirmCard({ firm }) {
  const d = useData();
  const [flags, setFlags] = useState(firm.flags || {});
  const [notes, setNotes] = useState(firm.notes || "");
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(flags) !== JSON.stringify(firm.flags || {}) || notes !== (firm.notes || "");
  const count = d.cmpLib.rows.filter((l) => l.active && evalApplies(flags, l.applies)).length;
  const save = async () => {
    setBusy(true);
    const r = await run(supabase.from("hub_cmp_firms").update({ flags, notes, updated_at: new Date().toISOString() }).eq("id", firm.id), `${firm.id} saved`);
    if (r.ok) { await regenerate(); d.cmpFirms.reload(); d.cmpItems.reload(); }
    setBusy(false);
  };
  return (
    <div className="ipanel">
      <div className="ipanel-head">
        <div><h3>{firm.name} ({firm.id})</h3><p>{firm.constitution} · <b>{count}</b> compliances apply with these settings</p></div>
        <button className="btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
      </div>
      {FLAG_GROUPS.map(([g, keys]) => (
        <div key={g} style={{ marginBottom: 10 }}>
          <div className="day-block-title">{g}</div>
          <div className="cmp-flags">{keys.map((k) => (
            <label key={k} className={`cmp-flag ${flags[k] ? "on" : ""}`}>
              <input type="checkbox" checked={!!flags[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} /> {FLAGS[k]}
            </label>))}</div>
        </div>
      ))}
      <label className={`cmp-flag ${flags.confirmed ? "on" : ""}`} style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={!!flags.confirmed} onChange={(e) => setFlags({ ...flags, confirmed: e.target.checked })} /> <b>I have checked these settings — they are correct</b>
      </label>
      <Field label="Notes"><input className="inp" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </div>
  );
}

function EmailPanel() {
  const d = useData();
  const [on, setOn] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data } = await supabase.from("hub_cmp_settings").select("*").eq("k", "email_enabled").maybeSingle();
    setOn(data?.v === "true");
    const { data: l } = await supabase.from("hub_cmp_mail_log").select("*").order("id", { ascending: false }).limit(8);
    setLog(l || []);
  };
  useEffect(() => { load(); }, []);
  const toggle = async () => {
    setBusy(true);
    const r = await run(supabase.from("hub_cmp_settings").update({ v: on ? "false" : "true" }).eq("k", "email_enabled"), on ? "Daily emails switched off" : "Daily emails switched on");
    setBusy(false); if (r.ok) load();
  };
  const test = async () => {
    setBusy(true);
    const r = await run(supabase.rpc("hub_cmp_send_reminders", { p_only: d.me.id, p_force: true }));
    setBusy(false);
    if (r.ok) { await load(); }
  };
  const last = log[0];
  return (
    <div className="ipanel cmp-mailpanel">
      <div className="ipanel-head">
        <div><h3>📧 Email reminders</h3>
          <p>Every morning at 8:00 each person gets one email with their items due (at lead time, 7, 3, 1 and 0 days before) and overdue items (day 1, 3, 7, then weekly). Checkers get “filed – please check”. Owners also get escalations and, on Mondays, a two-week overview.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-ghost" disabled={busy} onClick={test}>✉️ Send me a test now</button>
          <button className={on ? "btn-danger" : "cmp-btn-add"} disabled={busy || on === null} onClick={toggle}>{on ? "Switch off" : "Switch on daily emails"}</button>
        </div>
      </div>
      <div className="small-muted" style={{ marginBottom: 6 }}>Status: <b style={{ color: on ? "#16a34a" : "#b45309" }}>{on ? "ON — sending daily at 8:00" : "OFF"}</b>
        {last && last.status >= 400 && <span className="due-over"> · Last send failed: {(last.response || "").includes("not verified") ? "velite.in is not verified in Resend yet (add the 3 DNS records at Wix)" : last.response}</span>}</div>
      {log.length > 0 && (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Sent</th><th>To</th><th>Subject</th><th>Result</th></tr></thead>
          <tbody>{log.map((l) => (
            <tr key={l.id}><td className="nowrap">{fmtDateTime(l.sent_at)}</td><td>{l.to_email}</td><td>{l.subject}</td>
              <td>{l.status >= 200 && l.status < 300 ? <span style={{ color: "#16a34a" }}>✓ delivered to Resend</span> : <span className="due-over">✗ {l.status}</span>}</td></tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}
