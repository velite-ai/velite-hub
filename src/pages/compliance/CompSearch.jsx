import { useMemo, useState } from "react";
import { useData } from "../../lib/data";
import { fmtDate } from "../../lib/dates";
import { evalApplies, FirmBadge } from "./common";

// One search box for the whole Compliance Tracker: licences, papers, checklist points and due items.
const LIMIT = 8;
const has = (hay, words) => words.every((w) => hay.includes(w));
const low = (...parts) => parts.filter(Boolean).join(" ").toLowerCase();

export default function CompSearch({ onOpenItem, onOpenLicence, onOpenChecklist }) {
  const d = useData();
  const [q, setQ] = useState("");
  const words = q.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  const active = q.trim().length >= 2;

  const res = useMemo(() => {
    if (!active) return null;
    const firms = d.cmpFirms.rows;
    const firmName = (id) => firms.find((f) => f.id === id)?.name || id;
    const licences = d.cmpLic.rows.filter((l) => !l.deleted_at && has(low(l.title, l.number, l.authority, l.notes, firmName(l.firm_id), l.firm_id), words));
    const licById = new Map(d.cmpLic.rows.map((l) => [l.id, l]));
    const pointByCode = new Map(d.chkPoints.rows.map((p) => [p.code, p]));
    const papers = d.cmpDocs.rows.filter((x) => !x.deleted_at).map((x) => {
      let parent = "", target = null;
      if (x.parent_type === "licence") { const l = licById.get(x.parent_id); if (!l || l.deleted_at) return null; parent = l.title; target = { licence: l.id }; }
      else { const [firm, code] = String(x.parent_id).split("|"); const p = pointByCode.get(code); parent = p ? p.q : code; target = { firm, code, dept: p?.dept }; }
      return has(low(x.kind, x.doc_no, x.notes, x.file_name, parent, firmName(x.firm_id)), words) ? { x, parent, target } : null;
    }).filter(Boolean);
    const points = d.chkPoints.rows.filter((p) => p.active && has(low(p.code, p.q, p.why, p.law, p.dept, p.evidence), words));
    const libTitle = (c) => d.cmpLib.rows.find((l) => l.code === c)?.title || c;
    const items = d.cmpItems.rows.filter((i) => !i.deleted_at && has(low(libTitle(i.code), i.period_label, i.notes, i.ref_no, firmName(i.firm_id), i.firm_id), words))
      .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    return { licences, papers, points, items, libTitle };
  }, [active, q, d.cmpLic.rows, d.cmpDocs.rows, d.chkPoints.rows, d.cmpItems.rows, d.cmpLib.rows, d.cmpFirms.rows]); // eslint-disable-line

  const total = res ? res.licences.length + res.papers.length + res.points.length + res.items.length : 0;
  const more = (n) => n > LIMIT && <div className="cs-more">+ {n - LIMIT} more. Type more of the name to narrow it down.</div>;

  return (
    <div className="cs chk-noprint">
      <div className="cs-box">
        <input className="inp cs-inp" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")}
          placeholder="🔎 Search all of Compliance: licence name or number, paper, checklist point, due item…" aria-label="Search Compliance" />
        {q && <button className="btn-ghost cs-clear" onClick={() => setQ("")}>Clear</button>}
      </div>
      {q.trim().length === 1 && <div className="cs-hint">Type at least 2 letters.</div>}
      {active && (
        <div className="cs-panel">
          {total === 0 && <div className="cs-empty">Nothing found for “{q.trim()}”. Try a shorter word, a licence number, or the firm name.</div>}

          {res.licences.length > 0 && <div className="cs-group"><h4>📜 Licences and certificates <span>{res.licences.length}</span></h4>
            {res.licences.slice(0, LIMIT).map((l) => (
              <button key={l.id} className="cs-row" onClick={() => { onOpenLicence(l.id); setQ(""); }}>
                <FirmBadge id={l.firm_id} /><b>{l.title}</b><small>{[l.number, l.authority].filter(Boolean).join(" · ")}{l.next_due ? ` · due ${fmtDate(l.next_due)}` : ""}</small>
              </button>))}{more(res.licences.length)}</div>}

          {res.papers.length > 0 && <div className="cs-group"><h4>📂 Papers <span>{res.papers.length}</span></h4>
            {res.papers.slice(0, LIMIT).map(({ x, parent, target }) => (
              <button key={x.id} className="cs-row" onClick={() => { target.licence ? onOpenLicence(target.licence) : onOpenChecklist({ firm: target.firm, dept: target.dept }); setQ(""); }}>
                <FirmBadge id={x.firm_id} /><b>{x.kind}{x.doc_no ? ` · ${x.doc_no}` : ""}</b><small>{parent}{x.valid_till ? ` · valid till ${fmtDate(x.valid_till)}` : ""}</small>
              </button>))}{more(res.papers.length)}</div>}

          {res.points.length > 0 && <div className="cs-group"><h4>✅ Checklist points <span>{res.points.length}</span></h4>
            {res.points.slice(0, LIMIT).map((p) => (
              <div key={p.code} className="cs-row cs-pt">
                <b>{p.code}</b><span className="cs-q">{p.q}<small>{p.dept}{p.law ? ` · ${p.law}` : ""}</small></span>
                <span className="cs-firms">{d.cmpFirms.rows.filter((f) => evalApplies(f.flags, p.applies)).map((f) => (
                  <button key={f.id} className="cs-fbtn" title={`Open ${p.dept} for ${f.name}`} onClick={() => { onOpenChecklist({ firm: f.id, dept: p.dept }); setQ(""); }}><FirmBadge id={f.id} /></button>))}</span>
              </div>))}{more(res.points.length)}</div>}

          {res.items.length > 0 && <div className="cs-group"><h4>📋 Due items <span>{res.items.length}</span></h4>
            {res.items.slice(0, LIMIT).map((i) => (
              <button key={i.id} className="cs-row" onClick={() => { onOpenItem({ id: i.id }); setQ(""); }}>
                <FirmBadge id={i.firm_id} /><b>{res.libTitle(i.code)}</b><small>{i.period_label} · due {fmtDate(i.due_date)} · {i.status}</small>
              </button>))}{more(res.items.length)}</div>}
        </div>
      )}
    </div>
  );
}
