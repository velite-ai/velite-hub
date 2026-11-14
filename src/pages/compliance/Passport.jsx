import { useMemo, useRef, useState } from "react";
import { useData } from "../../lib/data";
import { daysUntil, fmtDate } from "../../lib/dates";
import { firmColor, openProof } from "./common";
import { docsOf } from "./DocChain";

// Firm passport: one clear page per firm. Reads the Licence register and its papers; nothing is stored here.
const SOON_DAYS = 60;
const GROUPS = ["Licences and regulatory", "Export and trade", "Safety and quality", "Insurance", "Vehicles", "Other"];

function groupOf(l) {
  const t = (l.title || "").toLowerCase();
  if (/^motor insurance|vehicle/.test(t)) return "Vehicles";
  if (/insurance|policy/.test(t)) return "Insurance";
  if (/iec|import export|lut|legal metrology|weights|measures|rcmc|export|customs/.test(t)) return "Export and trade";
  if (/fire|iso |iso9|zed|gmp|calibration|stability/.test(t)) return "Safety and quality";
  if (/licen|cos-8|form 2|form 4|consent|factory|registration|fssai|drug|permission|clu|land use/.test(t)) return "Licences and regulatory";
  return "Other";
}

function statusOf(date) {
  if (!date) return { k: "none", pill: "No expiry date" };
  const n = daysUntil(date);
  if (n < 0) return { k: "expired", pill: `Expired ${-n} day${-n === 1 ? "" : "s"} ago`, n };
  if (n <= SOON_DAYS) return { k: "soon", pill: `Due in ${n} day${n === 1 ? "" : "s"}`, n };
  return { k: "ok", pill: "In order", n };
}

export default function Passport() {
  const d = useData();
  const firms = d.cmpFirms.rows;
  const [firmId, setFirmId] = useState(firms[0]?.id || "");
  const [openRow, setOpenRow] = useState(null);
  const firm = firms.find((f) => f.id === firmId) || firms[0];
  const root = useRef(null);

  // Fit the passport on ONE A4 page: lay it out at print width, measure it, and shrink only if it is taller than the page.
  const printIt = () => {
    const el = root.current; if (!el) return window.print();
    el.style.removeProperty("--pp-zoom");
    el.classList.add("pp-measure");
    const h = el.scrollHeight;
    el.classList.remove("pp-measure");
    const pageH = 262 * (96 / 25.4);            // A4 height minus margins, in CSS px (with spare room)
    el.style.setProperty("--pp-zoom", Math.max(0.4, Math.min(1, pageH / h)).toFixed(3));
    window.print();
  };

  const rows = useMemo(() => d.cmpLic.rows
    .filter((l) => !l.deleted_at && l.firm_id === firm?.id)
    .map((l) => {
      const date = l.next_due || l.valid_till || null;
      const docs = docsOf(d.cmpDocs.rows, "licence", l.id);
      return { l, date, st: statusOf(date), docs, group: groupOf(l) };
    }), [d.cmpLic.rows, d.cmpDocs.rows, firm?.id]);

  if (!firm) return <div className="loading">Loading…</div>;
  const count = (k) => rows.filter((r) => r.st.k === k).length;
  const papers = rows.reduce((n, r) => n + r.docs.length, 0);
  const urgent = rows.filter((r) => r.st.k === "expired" || r.st.k === "soon").sort((a, b) => a.st.n - b.st.n);
  const coming = rows.filter((r) => r.date && r.st.n >= 0 && r.st.n <= 365).sort((a, b) => (a.date < b.date ? -1 : 1));
  const grouped = GROUPS.map((g) => [g, rows.filter((r) => r.group === g).sort((a, b) => (a.date || "9999") < (b.date || "9999") ? -1 : 1)]).filter(([, r]) => r.length);
  const color = firmColor(firm.id);

  return (
    <div className="pp" ref={root}>
      <div className="pp-switch chk-noprint">
        {firms.map((f) => <button key={f.id} className={f.id === firm.id ? "on" : ""} onClick={() => { setFirmId(f.id); setOpenRow(null); }}><i style={{ background: firmColor(f.id) }} />{f.name}</button>)}
      </div>

      <div className="pp-hero">
        <div>
          <div className="pp-kicker" style={{ color }}>Firm passport</div>
          <h2>{firm.name}</h2>
          <div className="pp-sub">{[firm.constitution, firm.notes].filter(Boolean).join(" · ")}</div>
        </div>
        <button className="btn-ghost chk-noprint" onClick={printIt}>🖨️ Print / save as PDF</button>
      </div>

      <div className="pp-counters">
        <div className="pp-c expired"><b>{count("expired")}</b><span>Expired</span><small>Renew now</small></div>
        <div className="pp-c soon"><b>{count("soon")}</b><span>Due soon</span><small>Within {SOON_DAYS} days</small></div>
        <div className="pp-c ok"><b>{count("ok") + count("none")}</b><span>In order</span><small>Valid, or no expiry date</small></div>
        <div className="pp-c none"><b>{papers}</b><span>Papers on file</span><small>For this firm's licences</small></div>
      </div>

      {rows.length === 0 && <div className="pp-box">No licences or certificates are in the Licence register for this firm yet.</div>}

      {urgent.length > 0 && (
        <div className="pp-box">
          <h3>Needs attention</h3>
          <div className="pp-hint">Most urgent first.</div>
          {urgent.map((r) => (
            <div key={r.l.id} className={`pp-urgent ${r.st.k}`}>
              <span className={`pp-pill ${r.st.k}`}>{r.st.pill}</span>
              <div><b>{r.l.title}</b><small>{r.st.k === "expired" ? "Ended " : "Ends "}{fmtDate(r.date)}{r.l.authority ? ` · ${r.l.authority}` : ""}</small></div>
            </div>
          ))}
        </div>
      )}

      <div className="pp-cols">
        <div className="pp-main">
          {grouped.map(([g, list]) => (
            <div key={g} className="pp-box pp-group">
              <div className="pp-gh"><h3>{g}</h3><span>{list.length} item{list.length === 1 ? "" : "s"}</span></div>
              {list.map((r) => (
                <div key={r.l.id} className={`pp-row ${r.st.k}`}>
                  <div className="pp-name"><b>{r.l.title}</b><small>{[r.l.number, r.l.authority].filter(Boolean).join(" · ")}</small></div>
                  <div className="pp-date"><small>{r.date ? "Next due / ends" : "Validity"}</small>{r.date ? fmtDate(r.date) : "Does not expire"}</div>
                  <span className={`pp-pill ${r.st.k}`}>{r.st.pill}</span>
                  <button className="link-btn pp-papers chk-noprint" onClick={() => setOpenRow(openRow === r.l.id ? null : r.l.id)}>{r.docs.length} paper{r.docs.length === 1 ? "" : "s"} {openRow === r.l.id ? "▾" : "›"}</button>
                  {openRow === r.l.id && (
                    <div className="pp-docs">
                      {r.docs.length === 0 && <small>No papers on file.</small>}
                      {r.docs.map((x) => (
                        <div key={x.id}>
                          <b>{x.kind}</b>{x.doc_no ? ` · ${x.doc_no}` : ""}
                          {(x.valid_from || x.valid_till) && <small> · valid {x.valid_from ? fmtDate(x.valid_from) : "…"} → {x.valid_till ? fmtDate(x.valid_till) : "…"}</small>}
                          {x.file_path && <button className="link-btn" onClick={() => openProof(x.file_path)}> 📎 Open</button>}
                          {x.link && <a href={x.link} target="_blank" rel="noreferrer"> Link ↗</a>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="pp-side">
          <div className="pp-box">
            <h3>Next 12 months</h3>
            <div className="pp-hint">Renewals and fees falling due, in date order.</div>
            {coming.length === 0 && <small>Nothing falls due in the next 12 months.</small>}
            {coming.map((r) => {
              const dt = new Date(r.date + "T00:00:00");
              return (
                <div key={r.l.id} className="pp-tl">
                  <div className="pp-tl-d"><small>{dt.toLocaleString("en-GB", { month: "short" })}</small><b>{dt.getDate()}</b></div>
                  <div><b>{r.l.title}</b><small>In {r.st.n} days{dt.getFullYear() !== new Date().getFullYear() ? ` · ${dt.getFullYear()}` : ""}</small></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
