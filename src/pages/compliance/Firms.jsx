import { useState } from "react";
import { supabase } from "../../supabase";
import { useData, run } from "../../lib/data";
import { Field } from "../../components/ui";
import { FLAGS, FLAG_GROUPS, regenerate, evalApplies } from "./common";

export default function Firms() {
  const d = useData();
  return (
    <>
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
