import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabase";
import { toast } from "../lib/data";
import { Empty } from "../components/ui";
import { KINDS, buildPaper, paperContext, kindOfCountryDoc, fingerprint } from "../lib/exportDocs";
import { paperToDocx } from "../lib/exportDocx";
import { preflight } from "../lib/shipment";
import { todayISO } from "../lib/qc";

// Papers of one shipment: preview, print, Word, and an automatic saved copy every time a paper is printed or downloaded.

const PLAIN_KEY = "exp-plain-header";
const readPlain = () => { try { return localStorage.getItem(PLAIN_KEY) !== "0"; } catch { return true; } };
const stamp = (t) => { const d = new Date(t); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function Paper({ paper }) {
  return (
    <div className={`ep-page ${paper.landscape ? "ep-land" : ""}`}>
      {paper.blocks.map((k, i) => {
        if (!k) return null;
        if (k.t === "head") return <div key={i} className="ep-head"><div className="ep-firm">{k.name}</div>{k.lines.map((l, j) => <div key={j}>{l}</div>)}</div>;
        if (k.t === "gap") return <div key={i} style={{ height: `${k.mm}mm` }} />;
        if (k.t === "title") return <div key={i}><div className="ep-title">{k.text}</div>{k.sub && <div className="ep-sub">{k.sub}</div>}</div>;
        if (k.t === "para") return <p key={i} className={`ep-p ${k.small ? "ep-small" : ""} ${k.bold ? "ep-bold" : ""}`} style={{ textAlign: k.align || "left" }}>{k.text}</p>;
        if (k.t === "row") return <div key={i} className="ep-row">{k.items.map((it, j) => <div key={j} className="ep-box"><div className="ep-label">{it.label}</div>{it.lines.map((l, x) => <div key={x}>{l}</div>)}</div>)}</div>;
        if (k.t === "table") return (
          <table key={i} className="ep-tbl"><thead><tr>{k.head.map((h, j) => <th key={j} style={{ width: `${k.widths[j]}%` }}>{h}</th>)}</tr></thead>
            <tbody>{k.rows.map((r, x) => <tr key={x}>{r.map((v, j) => <td key={j} style={{ textAlign: k.align[j] === "r" ? "right" : k.align[j] === "c" ? "center" : "left", whiteSpace: "pre-line" }}>{v}</td>)}</tr>)}
              {(k.foot || []).map((r, x) => <tr key={`f${x}`} className="ep-foot">{r.map((v, j) => <td key={j} style={{ textAlign: k.align[j] === "r" ? "right" : k.align[j] === "c" ? "center" : "left" }}>{v}</td>)}</tr>)}</tbody></table>);
        if (k.t === "sign") return <div key={i} className="ep-sign"><div className="ep-bold">{k.forFirm}</div><div className="ep-sign-space" />{k.name && <div>{k.name}</div>}{k.title && <div>{k.title}</div>}</div>;
        return null;
      })}
    </div>
  );
}

export default function Papers({ ship, lines, d, batchState, onClose }) {
  const [kind, setKind] = useState("invoice"); const [plain, setPlain] = useState(readPlain); const [anyway, setAnyway] = useState(false);
  const [saved, setSaved] = useState([]); const [printing, setPrinting] = useState(null); const [view, setView] = useState(null);
  const togglePlain = (v) => { setPlain(v); try { localStorage.setItem(PLAIN_KEY, v ? "1" : "0"); } catch { /* ignore */ } };
  const loadSaved = async () => { const { data } = await supabase.from("exp_documents").select("id,kind,title,version,input_hash,created_by_name,created_at,content").eq("shipment_id", ship.id).order("created_at", { ascending: false }); setSaved(data || []); };
  useEffect(() => { loadSaved(); }, [ship.id]); // eslint-disable-line
  const ctx = useMemo(() => paperContext(ship, lines, d, plain), [ship, lines, d, plain]);
  const papers = useMemo(() => Object.fromEntries(KINDS.map(([k]) => [k, buildPaper(k, ctx)])), [ctx]);
  const paper = view ? view.content : papers[kind];
  const problems = useMemo(() => preflight(ship, lines.map((l) => ({ ...l })), { firm: ctx.firm, party: ctx.party, country: d.countries.find((c) => c.country === ship.country), others: d.shipments.filter((x) => x.id !== ship.id), batchState, today: todayISO() }).filter((c) => c.level === "error"), [ship, lines, ctx, d, batchState]);
  const blocked = problems.length > 0 && !anyway;
  const country = d.countries.find((c) => c.country === ship.country);
  const latest = (k) => saved.find((x) => x.kind === k);

  // one more version only when the paper's content has changed since the last saved copy
  const saveCopy = async (p) => {
    const last = saved.find((x) => x.kind === p.kind); const fp = fingerprint(p);
    if (last && last.input_hash === fp) return;
    const r = await supabase.from("exp_documents").insert({ shipment_id: ship.id, kind: p.kind, title: p.title, version: (last?.version || 0) + 1, content: p, input_hash: fp });
    if (r.error) { toast(`The paper was made but the copy could not be saved: ${r.error.message}`, "err"); return; }
    toast(`Saved copy: ${p.title} v${(last?.version || 0) + 1}`); loadSaved();
  };
  const print = async (p) => {
    if (blocked && !view) return;
    if (!view) await saveCopy(p);
    setPrinting(p); document.body.classList.add("ex-printing");
    const st = document.createElement("style"); st.id = "ex-page-style"; st.textContent = `@page{size:A4 ${p.landscape ? "landscape" : "portrait"};margin:10mm;}`; document.head.appendChild(st);
    setTimeout(() => { const t = document.title; document.title = `${p.file || p.title}`; window.print(); document.title = t; document.body.classList.remove("ex-printing"); st.remove(); setPrinting(null); }, 250);
  };
  const word = async (p) => {
    if (blocked && !view) return;
    if (!view) await saveCopy(p);
    const blob = await paperToDocx(p); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${(p.file || p.title).replace(/[^\w .-]+/g, "")}.docx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const todo = (country?.docs || []).map((name) => ({ name, kind: kindOfCountryDoc(name) }));

  return (
    <div className="ex-editor">
      <div className="qc-filters" style={{ marginBottom: 8 }}>
        <button className="btn-ghost sm" onClick={onClose}>← Back to the shipment</button>
        <b style={{ flex: 1, fontSize: 18 }}>Papers for {ship.invoice_no || "this shipment"}</b>
      </div>
      {problems.length > 0 && (
        <div className="mt-dup">⛔ {problems.length} problem{problems.length > 1 ? "s" : ""} in the shipment still to fix: {problems.slice(0, 3).map((p) => p.text).join(" · ")}{problems.length > 3 ? " …" : ""}
          <label style={{ display: "block", marginTop: 4 }}><input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} /> I have read them. Make the papers anyway.</label></div>)}
      <div className="ipanel"><div className="ipanel-head"><div><h3>{country ? `${country.country}: papers needed` : "Papers"}</h3><p>The Hub prepares the ones marked ✓ in the tabs below. Papers like the shipping bill, e-way bill, MSDS or COA are attached separately.</p></div></div>
        {todo.length === 0 ? <div className="small-muted">No list for this country yet. Add it under Countries.</div> : todo.map((t, i) => (
          <div key={i} className="qc-row"><span className="qc-row-main"><b>{t.name}</b></span>
            {t.kind ? <button className="btn-ghost sm" onClick={() => { setView(null); setKind(t.kind); }}>{latest(t.kind) ? `✓ saved v${latest(t.kind).version}` : "Prepare"}</button> : <span className="small-muted">attach separately</span>}</div>))}
      </div>
      <div className="tk-views qc-tabs">
        {KINDS.map(([k, l]) => <button key={k} className={!view && kind === k ? "on" : ""} onClick={() => { setView(null); setKind(k); }}>{l}{latest(k) ? " ✓" : ""}</button>)}
      </div>
      <div className="qc-filters" style={{ margin: "8px 0" }}>
        <label style={{ flex: 1, fontSize: 14 }}><input type="checkbox" checked={!plain} onChange={(e) => togglePlain(!e.target.checked)} /> I print on pre-printed letterhead (leave the top blank, do not print the firm header)</label>
        {view && <button className="btn-ghost sm" onClick={() => setView(null)}>Back to the current paper</button>}
        <button className="btn-ghost" onClick={() => word(paper)} disabled={blocked && !view}>⬇ Word</button>
        <button className="btn-primary" onClick={() => print(paper)} disabled={blocked && !view}>🖨 Print / save as PDF</button>
      </div>
      {view && <div className="rg-note amber">Showing the saved copy: {view.title} v{view.version}, {stamp(view.created_at)} by {view.created_by_name}. Printing it does not make a new version.</div>}
      <div className="ep-scroll"><Paper paper={paper} /></div>
      <div className="small-muted" style={{ margin: "6px 0" }}>The Hub prints the signatory’s name only. Sign and stamp the printout by hand. Every print or Word download saves a copy; a new version is added only when the paper has changed.</div>

      <div className="ipanel"><div className="ipanel-head"><div><h3>Saved copies</h3></div></div>
        {saved.length === 0 ? <Empty>Nothing saved yet. A copy is saved the first time you print or download a paper.</Empty> : saved.map((x) => (
          <div key={x.id} className="qc-row"><span className="qc-row-main"><b>{x.title} v{x.version}</b><small>{stamp(x.created_at)} · {x.created_by_name}</small></span><button className="btn-ghost sm" onClick={() => { setView({ ...x, content: x.content }); window.scrollTo(0, 0); }}>View</button></div>))}
      </div>
      {printing && createPortal(<div id="exp-print"><Paper paper={printing} /></div>, document.body)}
    </div>
  );
}
