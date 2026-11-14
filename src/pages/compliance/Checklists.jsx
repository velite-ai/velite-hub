import { useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { useData, run, toast } from "../../lib/data";
import { fmtDate, todayISO, addDaysISO } from "../../lib/dates";
import { Modal, Field, Empty } from "../../components/ui";
import { evalApplies, firmColor, FirmBadge, uploadProof, openProof, personName } from "./common";
import CHECK_DEPTS from "./checkDepts.json";
import DocChain, { docsOf } from "./DocChain";

const DEPT = Object.fromEntries(CHECK_DEPTS.map(([n, icon, c]) => [n, { icon, c }]));
const dstyle = (d) => DEPT[d] || { icon: "📌", c: "#64748b" };
const INSPECTIONS = [["fda", "💊 FDA / Drug Inspector"], ["ppcb", "🌿 Pollution Board"], ["labour", "👥 Labour & Factory Inspector"], ["fire", "🔥 Fire Officer"], ["gst", "🧾 GST officer"], ["lm", "⚖️ Legal Metrology"]];

function fyStart() {
  const t = todayISO(); const y = Number(t.slice(0, 4)); const m = Number(t.slice(5, 7));
  return `${m < 4 ? y - 1 : y}-04-01`;
}
// The answer that counts today: last year's answers and "re-check" answers count as blank.
const fresh = (a) => a && !a.stale && (a.answered_at || "").slice(0, 10) >= fyStart();
const eff = (a) => (fresh(a) ? a.answer : null);

export function stat(points, amap, firmId) {
  let ok = 0, no = 0, noH = 0, redo = 0;
  for (const p of points) {
    const a = amap.get(`${firmId}|${p.code}`); const e = eff(a);
    if (e === "yes" || e === "na") ok++;
    else if (e === "no") { no++; if (p.risk === "H") noH++; }
    else if (a) redo++;
  }
  const t = points.length;
  const tone = t === 0 ? "none" : ok === t ? "green" : noH > 0 ? "red" : ok + no === 0 ? "grey" : "amber";
  return { t, ok, no, noH, redo, todo: t - ok - no, pct: t ? Math.round((100 * ok) / t) : 0, tone };
}

export default function Checklists({ onOpenItem }) {
  const d = useData();
  const [sel, setSel] = useState(null); // {firm, dept} or {firm, tag}
  const [inspFirm, setInspFirm] = useState("");
  const firms = d.cmpFirms.rows;
  const points = useMemo(() => d.chkPoints.rows.filter((p) => p.active), [d.chkPoints.rows]);
  const amap = useMemo(() => new Map(d.chkAnswers.rows.map((a) => [`${a.firm_id}|${a.code}`, a])), [d.chkAnswers.rows]);
  const byFirm = useMemo(() => Object.fromEntries(firms.map((f) => [f.id, points.filter((p) => evalApplies(f.flags, p.applies))])), [firms, points]);
  const depts = CHECK_DEPTS.map((x) => x[0]).filter((n) => points.some((p) => p.dept === n));

  if (d.chkPoints.loading || d.chkAnswers.loading) return <div className="loading">Loading…</div>;
  if (sel) {
    const firm = firms.find((f) => f.id === sel.firm);
    const list = (byFirm[sel.firm] || []).filter((p) => (sel.dept ? p.dept === sel.dept : p.tags.includes(sel.tag)));
    return <PointList firm={firm} points={list} amap={amap} dept={sel.dept} tag={sel.tag} onBack={() => setSel(null)} onOpenItem={onOpenItem} />;
  }

  const sendCard = async () => {
    const r = await run(supabase.rpc("hub_chk_send_scorecard", { p_only: d.me.id }));
    if (r.ok) toast(r.data ? "Scorecard sent to your email" : "Could not send — check your email in the profile");
  };
  const fi = inspFirm || firms[0]?.id;

  return (
    <>
      <div className="chk-firms">
        {firms.map((f) => {
          const s = stat(byFirm[f.id], amap, f.id);
          return (
            <div key={f.id} className="chk-firm" style={{ borderTopColor: firmColor(f.id) }}>
              <div className="chk-firm-top"><FirmBadge id={f.id} /> <b>{f.name}</b></div>
              <div className="chk-firm-pct" style={{ color: firmColor(f.id) }}>{s.pct}%<span> in order</span></div>
              <div className="chk-bar"><i style={{ width: `${s.pct}%`, background: "#16a34a" }} /><i style={{ width: `${s.t ? (100 * s.no) / s.t : 0}%`, background: "#dc2626" }} /></div>
              <div className="chk-firm-sub">{s.ok} of {s.t} points OK · <b className={s.no ? "chk-red" : ""}>{s.no} gap{s.no === 1 ? "" : "s"}</b> · {s.todo} to answer</div>
            </div>
          );
        })}
      </div>

      <div className="ipanel chk-noprint">
        <div className="ipanel-head"><div><h3>🔎 Inspection-ready view</h3><p>An inspector is coming? Pick the firm and the type of visit. You get only the points that officer will check.</p></div></div>
        <div className="chk-insp">
          <select className="inp" style={{ width: "auto" }} value={fi} onChange={(e) => setInspFirm(e.target.value)}>{firms.map((f) => <option key={f.id} value={f.id}>{f.id} — {f.name}</option>)}</select>
          {INSPECTIONS.map(([tag, label]) => {
            const n = (byFirm[fi] || []).filter((p) => p.tags.includes(tag)).length;
            return n ? <button key={tag} className="chk-insp-btn" onClick={() => setSel({ firm: fi, tag })}>{label} <span>{n}</span></button> : null;
          })}
        </div>
      </div>

      <div className="ipanel">
        <div className="ipanel-head">
          <div><h3>✅ Department checklists</h3><p>🟢 all in order · 🟠 work pending · 🔴 a high-risk gap is open · ⚪ not started. The number shows points in order out of total. Click a box to open that checklist.</p></div>
          <div className="chk-noprint" style={{ display: "flex", gap: 6 }}>
            {d.isOwner && <button className="btn-ghost" onClick={sendCard}>📧 Email me the scorecard</button>}
            <button className="btn-ghost" onClick={() => window.print()}>🖨️ Print</button>
          </div>
        </div>
        <div className="chk-grid-wrap">
          <table className="chk-grid">
            <thead><tr><th>Department</th>{firms.map((f) => <th key={f.id}><FirmBadge id={f.id} /></th>)}</tr></thead>
            <tbody>
              {depts.map((dept) => (
                <tr key={dept}>
                  <td><span className="chk-dicon" style={{ background: dstyle(dept).c + "1c" }}>{dstyle(dept).icon}</span> {dept}</td>
                  {firms.map((f) => {
                    const s = stat(byFirm[f.id].filter((p) => p.dept === dept), amap, f.id);
                    const head = d.chkHeads.rows.find((h) => h.firm_id === f.id && h.dept === dept);
                    return <td key={f.id}>{s.t === 0 ? <span className="chk-cell none">–</span> : (
                      <button className={`chk-cell ${s.tone}`} title={`${s.ok} OK · ${s.no} gaps · ${s.todo} to answer${head?.head_id ? ` · Head: ${personName(d.profiles, head.head_id)}` : ""}`} onClick={() => setSel({ firm: f.id, dept })}>
                        {s.ok}/{s.t}{s.no > 0 && <em>{s.no} gap{s.no === 1 ? "" : "s"}</em>}
                      </button>)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function PointList({ firm, points, amap, dept, tag, onBack, onOpenItem }) {
  const d = useData();
  const [show, setShow] = useState("all");
  const [ans, setAns] = useState(null); // {point, mode}
  const [busy, setBusy] = useState(false);
  const people = d.profiles.rows.filter((p) => p.status === "approved");
  const headRow = dept && d.chkHeads.rows.find((h) => h.firm_id === firm.id && h.dept === dept);
  const isHead = headRow?.head_id === d.me.id;
  const s = stat(points, amap, firm.id);
  const get = (p) => amap.get(`${firm.id}|${p.code}`);
  const redo = points.filter((p) => { const a = get(p); return a && !fresh(a) && a.answer !== "no"; });
  const list = points.filter((p) => {
    const e = eff(get(p));
    return show === "all" || (show === "todo" && !e) || (show === "no" && e === "no") || (show === "high" && p.risk === "H");
  });
  const title = dept ? dept : INSPECTIONS.find((x) => x[0] === tag)?.[1] + " — inspection-ready list";
  const ds = dept ? dstyle(dept) : { icon: "🔎", c: "#1e3a8a" };

  const setHead = async (id) => {
    const r = await run(supabase.from("hub_chk_heads").upsert({ firm_id: firm.id, dept, head_id: id || null, updated_at: new Date().toISOString() }), "Department head saved");
    if (r.ok) d.chkHeads.reload();
  };
  const confirmAll = async (codes) => {
    setBusy(true);
    const r = await run(supabase.rpc("hub_chk_confirm", { p_firm: firm.id, p_codes: codes }), codes.length > 1 ? "Confirmed — still the same" : "Confirmed");
    setBusy(false); if (r.ok) d.chkAnswers.reload();
  };
  const recheck = async () => {
    const why = window.prompt("What changed? (for example: new machine, new product, new address, new staff)");
    if (!why || !why.trim()) return;
    const r = await run(supabase.rpc("hub_chk_recheck", { p_firm: firm.id, p_dept: dept, p_reason: why.trim() }), "Re-check started for this department");
    if (r.ok) d.chkAnswers.reload();
  };

  let lastDept = null;
  return (
    <>
      <div className="chk-head" style={{ borderLeftColor: ds.c }}>
        <button className="btn-ghost chk-noprint" onClick={onBack}>← All departments</button>
        <div className="chk-head-main">
          <div className="chk-head-title"><span>{ds.icon}</span> {title} <FirmBadge id={firm.id} /> <small>{firm.name}</small></div>
          <div className="chk-bar big"><i style={{ width: `${s.pct}%`, background: "#16a34a" }} /><i style={{ width: `${s.t ? (100 * s.no) / s.t : 0}%`, background: "#dc2626" }} /></div>
          <div className="chk-firm-sub">{s.ok} of {s.t} in order ({s.pct}%) · <b className={s.no ? "chk-red" : ""}>{s.no} gap{s.no === 1 ? "" : "s"}</b> · {s.todo} still to answer</div>
        </div>
        {dept && (
          <div className="chk-head-side chk-noprint">
            <label>Department head</label>
            {d.isOwner ? (
              <select className="inp" value={headRow?.head_id || ""} onChange={(e) => setHead(e.target.value)}><option value="">— not set —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
            ) : <b>{personName(d.profiles, headRow?.head_id) || "Not set"}</b>}
            {(d.isOwner || isHead) && <button className="link-btn" onClick={recheck}>🔄 Something changed — re-check</button>}
          </div>
        )}
      </div>

      {redo.length > 0 && (
        <div className="cmp-alert chk-noprint">
          🔄 <b>{redo.length} answer{redo.length === 1 ? "" : "s"} need a fresh look</b> (yearly self-audit or a change was reported). Check each one. If nothing has changed:{" "}
          <button className="link-btn" disabled={busy} onClick={() => window.confirm(`Confirm that all ${redo.length} points are still the same as before?`) && confirmAll(redo.map((p) => p.code))}>confirm all as still the same ✓</button>
        </div>
      )}

      <div className="seg chk-noprint" style={{ marginBottom: 12 }}>
        {[["all", `All (${points.length})`], ["todo", `To answer (${s.todo})`], ["no", `Gaps (${s.no})`], ["high", "High risk only"]].map(([k, l]) => <button key={k} className={show === k ? "on" : ""} onClick={() => setShow(k)}>{l}</button>)}
        <button onClick={() => window.print()}>🖨️ Print</button>
      </div>

      {list.length === 0 ? <Empty>Nothing here.</Empty> : list.map((p) => {
        const a = get(p); const e = eff(a); const old = a && !e;
        const item = a?.item_id && d.cmpItems.rows.find((i) => i.id === a.item_id);
        const sub = !dept && p.dept !== lastDept ? (lastDept = p.dept) : null;
        return (
          <div key={p.code}>
            {sub && <div className="chk-sub">{dstyle(sub).icon} {sub}</div>}
            <div className={`chk-pt ${e || (old ? "redo" : "")}`}>
              <div className="chk-pt-main">
                <div className="chk-q">{p.risk === "H" && <span className="chk-risk" title="High risk">HIGH</span>}{p.q}</div>
                <div className="chk-why">💡 {p.why}</div>
                <div className="chk-law">{p.law}{p.evidence ? ` · Proof to keep: ${p.evidence}` : ""}</div>
                {p.lic && <LicLine firm={firm} code={p.lic} onOpen={() => setAns({ point: p, mode: "yes" })} />}
                <PointPapers firm={firm} point={p} />
                {a && (
                  <div className="chk-ans">
                    {old && <span className="chk-tag redo">🔄 Re-check needed{a.stale_reason ? `: ${a.stale_reason}` : ""} — last answer was {a.answer === "yes" ? "Yes" : a.answer === "na" ? "Not applicable" : "No"}</span>}
                    {e === "yes" && <span className="chk-tag yes">✅ Yes</span>}
                    {e === "na" && <span className="chk-tag na">Not applicable</span>}
                    {e === "no" && <span className="chk-tag no">❌ Gap — fix by {fmtDate(a.action_due)}{a.action_owner ? ` · ${personName(d.profiles, a.action_owner)}` : " · no one assigned"}</span>}
                    {a.ref_no && <span>Ref: {a.ref_no}</span>}
                    {!p.lic && a.proof_path && <button className="link-btn" onClick={() => openProof(a.proof_path)}>📎 {a.proof_name || "file"}</button>}
                    {!p.lic && a.proof_link && <a href={a.proof_link} target="_blank" rel="noreferrer">Open proof ↗</a>}
                    {!p.lic && (() => { const n = docsOf(d.cmpDocs.rows, "check", `${firm.id}|${p.code}`).length; return n ? <button className="link-btn" onClick={() => setAns({ point: p, mode: "yes" })}>📂 {n} more paper{n === 1 ? "" : "s"}</button> : null; })()}
                    {a.note && <span className="chk-note">“{a.note}”</span>}
                    <span className="small-muted">{a.answered_by_name}, {fmtDate((a.answered_at || "").slice(0, 10))}</span>
                    {e === "no" && item && onOpenItem && <button className="link-btn chk-noprint" onClick={() => onOpenItem({ id: item.id })}>Open the action →</button>}
                  </div>
                )}
              </div>
              <div className="chk-btns chk-noprint">
                {old && a.answer !== "no" && <button className="chk-b same" disabled={busy} onClick={() => confirmAll([p.code])}>Still the same ✓</button>}
                <button className={`chk-b yes ${e === "yes" ? "on" : ""}`} onClick={() => setAns({ point: p, mode: "yes" })}>Yes</button>
                <button className={`chk-b no ${e === "no" ? "on" : ""}`} onClick={() => setAns({ point: p, mode: "no" })}>No</button>
                <button className={`chk-b na ${e === "na" ? "on" : ""}`} onClick={() => setAns({ point: p, mode: "na" })}>N/A</button>
              </div>
            </div>
          </div>
        );
      })}
      {ans && <AnswerModal firm={firm} point={ans.point} mode={ans.mode} prev={get(ans.point)} people={people} onClose={() => setAns(null)} />}
    </>
  );
}

function AnswerModal({ firm, point, mode, prev, people, onClose }) {
  const d = useData();
  const head = d.chkHeads.rows.find((h) => h.firm_id === firm.id && h.dept === point.dept)?.head_id || "";
  const keep = prev && prev.answer === mode;
  const [f, setF] = useState({
    note: keep ? prev.note || "" : "", ref: keep ? prev.ref_no || "" : "", link: keep ? prev.proof_link || "" : "",
    path: keep ? prev.proof_path || null : null, name: keep ? prev.proof_name || "" : "",
    owner: (keep && prev.action_owner) || head || "", due: (keep && prev.action_due) || addDaysISO(todayISO(), 30),
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const upload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); const r = await uploadProof(file, `${firm.id}/checklist/${point.code}`); setBusy(false);
    if (r) setF({ ...f, path: r.path, name: r.name });
  };
  const licRows = point.lic ? d.cmpLic.rows.filter((l) => !l.deleted_at && l.firm_id === firm.id && l.code === point.lic) : [];
  const save = async () => {
    if (mode === "yes" && point.lic) {
      if (!licRows.length) { toast("First add this licence to the Licence register (box above).", "err"); return; }
      const papers = licRows.reduce((n, l) => n + docsOf(d.cmpDocs.rows, "licence", l.id).length, 0);
      if (!papers && !licRows.some((l) => l.number)) { toast("Add at least one paper to the licence, or its number.", "err"); return; }
      f.ref = `Licence register · ${licRows.map((l) => l.number || l.title).join(", ")}`; f.link = ""; f.path = null; f.name = "";
    }
    const extra = docsOf(d.cmpDocs.rows, "check", `${firm.id}|${point.code}`);
    if (mode === "yes" && !f.ref.trim() && !f.link.trim() && !f.path && extra.length) { f.ref = `${extra.length} paper${extra.length === 1 ? "" : "s"} on file`; }
    if (mode === "yes" && !f.ref.trim() && !f.link.trim() && !f.path) { toast("Add proof for Yes: attach a file, paste a link, or write a reference number.", "err"); return; }
    if (mode === "na" && !f.note.trim()) { toast("Write why it does not apply.", "err"); return; }
    if (mode === "no" && !f.due) { toast("Choose the date by which it will be fixed.", "err"); return; }
    setBusy(true);
    const r = await run(supabase.rpc("hub_chk_answer", {
      p_firm: firm.id, p_code: point.code, p_answer: mode, p_note: f.note, p_ref: mode === "yes" ? f.ref : null, p_link: mode === "yes" ? f.link : null,
      p_path: mode === "yes" ? f.path : null, p_name: mode === "yes" ? f.name : null, p_owner: mode === "no" ? f.owner || null : null, p_due: mode === "no" ? f.due : null,
    }), mode === "no" ? "Saved — an action with reminders has been created" : "Saved");
    setBusy(false);
    if (r.ok) { d.chkAnswers.reload(); d.cmpItems.reload(); onClose(); }
  };
  const label = mode === "yes" ? "✅ Yes — we have this" : mode === "no" ? "❌ No — this is a gap" : "Not applicable to this firm";
  return (
    <Modal title={label} onClose={onClose} actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="chk-modal-q"><FirmBadge id={firm.id} /> {point.q}</div>
      {mode === "yes" && point.lic && <LicPanel firm={firm} code={point.lic} />}
      {mode === "yes" && !point.lic && <>
        <div className="form-hint" style={{ marginBottom: 8 }}>Give any one proof below. Suggested: <b>{point.evidence}</b>. Have older papers too (e.g. past retention certificates)? Add them all under “More papers”.</div>
        <Field label="Attach a file (max 15 MB)"><input type="file" onChange={upload} disabled={busy} />{f.path && <div className="form-hint">📎 {f.name}</div>}</Field>
        <Field label="Or paste a link (Google Drive etc.)"><input className="inp" placeholder="https://…" value={f.link} onChange={set("link")} /></Field>
        <Field label="Or licence / reference number, or where the paper is kept"><input className="inp" value={f.ref} onChange={set("ref")} /></Field>
        <Field label="Note (optional)"><input className="inp" value={f.note} onChange={set("note")} /></Field>
        <DocChain firmId={firm.id} type="check" id={`${firm.id}|${point.code}`} folder={`${firm.id}/checklist/${point.code}`} title="More papers for this point (optional — any number)" />
      </>}
      {mode === "no" && <>
        <div className="cmp-alert">Saying No is good — it shows the gap honestly. The app will create an action and send reminders until it is closed. When the action is marked done with proof, this point turns to Yes on its own.</div>
        <Field label="What is missing? (optional)"><input className="inp" value={f.note} onChange={set("note")} /></Field>
        <Field label="Who will fix it?"><select className="inp" value={f.owner} onChange={set("owner")}><option value="">— department head / not set —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
        <Field label="Fix by (date)"><input className="inp" type="date" value={f.due} onChange={set("due")} /></Field>
      </>}
      {mode === "na" && <Field label="Why does it not apply? (required)"><input className="inp" value={f.note} onChange={set("note")} placeholder="e.g. we do not make this type of product" /></Field>}
    </Modal>
  );
}


// Points that are a licence: the Licence register is the one place for its papers.
function LicLine({ firm, code, onOpen }) {
  const d = useData();
  const rows = d.cmpLic.rows.filter((l) => !l.deleted_at && l.firm_id === firm.id && l.code === code);
  if (!rows.length) return <div className="chk-lic none">📜 Not yet in the Licence register — <button className="link-btn" onClick={onOpen}>add it</button></div>;
  return <div className="chk-lic">{rows.map((l) => { const n = docsOf(d.cmpDocs.rows, "licence", l.id).length; return (
    <span key={l.id}>📜 <b>{l.title}</b>{l.number ? ` · ${l.number}` : ""} · {n} paper{n === 1 ? "" : "s"}{l.next_due ? ` · next due ${fmtDate(l.next_due)}` : ""} <button className="link-btn" onClick={onOpen}>view papers</button></span>); })}</div>;
}

// Papers on file for a point, shown whether or not the point has been answered yet.
// Licence points list the papers of their Licence register entries; other points list their own "more papers".
function PointPapers({ firm, point }) {
  const d = useData();
  const groups = point.lic
    ? d.cmpLic.rows.filter((l) => !l.deleted_at && l.firm_id === firm.id && l.code === point.lic).map((l) => ({ label: l.title, docs: docsOf(d.cmpDocs.rows, "licence", l.id) }))
    : [{ label: null, docs: docsOf(d.cmpDocs.rows, "check", `${firm.id}|${point.code}`) }];
  const total = groups.reduce((n, g) => n + g.docs.length, 0);
  if (!total) return null;
  const period = (x) => (x.valid_from || x.valid_till ? `valid ${x.valid_from ? fmtDate(x.valid_from) : "…"} → ${x.valid_till ? fmtDate(x.valid_till) : "…"}` : "");
  return (
    <details className="chk-papers chk-noprint" open>
      <summary>📂 {total} paper{total === 1 ? "" : "s"} on file</summary>
      {groups.map((g, gi) => g.docs.length > 0 && (
        <div key={gi}>
          {g.label && <div className="small-muted"><b>{g.label}</b></div>}
          <ul className="doc-list">{g.docs.map((x) => (
            <li key={x.id}>
              <div className="doc-main"><b>{x.kind}</b>{x.doc_no && <> · {x.doc_no}</>}{period(x) && <span className="small-muted"> · {period(x)}</span>}</div>
              <div className="doc-acts">
                {x.file_path && <button className="link-btn" onClick={() => openProof(x.file_path)}>📎 Open</button>}
                {x.link && <a href={x.link} target="_blank" rel="noreferrer">Link ↗</a>}
              </div>
            </li>))}</ul>
        </div>))}
    </details>
  );
}

function LicPanel({ firm, code }) {
  const d = useData();
  const lib = d.cmpLib.rows.find((l) => l.code === code);
  const rows = d.cmpLic.rows.filter((l) => !l.deleted_at && l.firm_id === firm.id && l.code === code);
  const [f, setF] = useState({ title: (lib?.title || "").replace(/ — .*$/, "").replace(/ \(.*\)$/, ""), number: "", issued_on: "", valid_till: "", next_due: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const create = async () => {
    if (!f.title.trim() || !f.next_due) { toast("Give the licence a name and its next due date (renewal / retention fee).", "err"); return; }
    setBusy(true);
    const r = await run(supabase.from("hub_cmp_licences").insert({ firm_id: firm.id, code, title: f.title.trim(), number: f.number.trim() || null, authority: lib?.authority || null,
      issued_on: f.issued_on || null, valid_till: f.valid_till || null, next_due: f.next_due }), "Added to the Licence register");
    setBusy(false); if (r.ok) { d.cmpLic.reload(); d.cmpItems.reload(); }
  };
  return (
    <div className="chk-licpanel">
      <div className="cmp-alert" style={{ marginBottom: 10 }}>📜 This point is a licence. Its papers are kept in <b>one place only — the Licence register</b> (Compliance → Licences). Anything you add here appears there too, and the renewal reminder comes from there.</div>
      {rows.length === 0 ? (
        <div className="doc-chain">
          <div className="doc-chain-head"><b>Add it to the Licence register</b></div>
          <div className="cmp-form">
            <Field label="Name"><input className="inp" value={f.title} onChange={set("title")} /></Field>
            <Field label="Licence number"><input className="inp" value={f.number} onChange={set("number")} /></Field>
            <Field label="Issued on"><input className="inp" type="date" value={f.issued_on} onChange={set("issued_on")} /></Field>
            <Field label="Valid till" hint="Leave empty if it stays valid while retention fee is paid."><input className="inp" type="date" value={f.valid_till} onChange={set("valid_till")} /></Field>
            <Field label="Next due date" hint="Next renewal or retention-fee date."><input className="inp" type="date" value={f.next_due} onChange={set("next_due")} /></Field>
          </div>
          <div style={{ textAlign: "right" }}><button className="btn-primary" disabled={busy} onClick={create}>{busy ? "Please wait…" : "Add to Licence register"}</button></div>
        </div>
      ) : rows.map((l) => (
        <div key={l.id}>
          <div className="small-muted" style={{ margin: "4px 0" }}><b>{l.title}</b>{l.number ? ` · ${l.number}` : ""}{l.next_due ? ` · next due ${fmtDate(l.next_due)}` : ""}</div>
          <DocChain firmId={firm.id} type="licence" id={l.id} folder={`${firm.id}/licences/${l.id}`} title="Full chain of papers (original + every retention / renewal)" />
        </div>
      ))}
    </div>
  );
}
