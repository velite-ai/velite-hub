import { useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { Modal, Field, Empty, SearchBox, useConfirm } from "../components/ui";
import { FIRM_COLORS } from "./compliance/common";
import { normBatch } from "../lib/batches";
import {
  STAGES, STAGE_KEYS, FIRMS, REMARKS, STATE_LABEL, STATE_COLOR, stateOf, isWaiting, releaseDate, qcDays, totalDays, median, avg,
  fmtD, fmtM, fmtT, tentativeGap, overdueDays, monthKey, monthLabel, todayISO, daysBetween, addDays, warningsFor, readOldSheet,
} from "../lib/qc";

// QC Release register: replaces the "Material Release Table" Google Sheet.
// Raw → Packing → Bulk → Finished product. Each record: received, sampled, QC release, Microbiology release.

const PAGE = 40;
const one = (n, d = 1) => (n == null ? "–" : (Math.round(n * 10 ** d) / 10 ** d).toString());
const lastMonths = (n) => { const out = []; const d = new Date(); d.setDate(1); for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`); } return out; };

export default function QcRelease() {
  const { qc, isOwner } = useData();
  const [view, setView] = useState("board");
  const [preset, setPreset] = useState(null);   // filter handed from the board to the list
  const [edit, setEdit] = useState(null);       // {row} or {stage}
  const today = todayISO();

  const rows = useMemo(() => qc.rows.filter((r) => !r.deleted_at).map((r) => ({ ...r, _state: stateOf(r, today) })), [qc.rows, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const toCheck = rows.filter((r) => (r.import_flags || []).length && !r.review_done).length;
  const goList = (p) => { setPreset(p); setView("entries"); };

  return (
    <div className="section qcp">
      <div className="mt-hero qc-hero">
        <div>
          <div className="mt-hero-title">🧪 QC Release</div>
          <div className="mt-hero-sub">Raw → Packing → Bulk → Finished product · sampled, QC released, Microbiology released · replaces the Material Release sheet</div>
        </div>
        <button className="qc-add" onClick={() => setEdit({ stage: "fp" })}>＋ New entry</button>
      </div>

      <div className="tk-views qc-tabs">
        {[["board", "📊 Today"], ["entries", "📋 Entries"], ["insights", "📈 Insights"], ...(isOwner ? [["check", `🔍 Data check${toCheck ? ` (${toCheck})` : ""}`]] : [])].map(([k, l]) => (
          <button key={k} className={view === k ? "on" : ""} onClick={() => { setView(k); if (k !== "entries") setPreset(null); }}>{l}</button>))}
      </div>

      {qc.loading ? <div className="loading">Loading…</div> : (
        view === "board" ? <Board rows={rows} today={today} goList={goList} onOpen={(r) => setEdit({ row: r })} />
        : view === "entries" ? <Entries rows={rows} preset={preset} today={today} onOpen={(r) => setEdit({ row: r })} onNew={(stage) => setEdit({ stage })} />
        : view === "insights" ? <Insights rows={rows} today={today} isOwner={isOwner} />
        : <DataCheck rows={rows} onOpen={(r) => setEdit({ row: r })} reload={qc.reload} />
      )}

      {edit && <EntryForm row={edit.row} stage={edit.stage} rows={rows} onClose={() => setEdit(null)} onSaved={qc.reload} />}
    </div>
  );
}

// ── Today ────────────────────────────────────────────────────────────────
function Board({ rows, today, goList, onOpen }) {
  const m0 = monthKey(today);
  const waitingQc = rows.filter((r) => r._state === "awaiting_qc");
  const waitingMicro = rows.filter((r) => r._state === "awaiting_micro");
  const hold = rows.filter((r) => r._state === "hold" || r._state === "rejected").filter((r) => daysBetween(r.sampling_date || r.entry_date, today) <= 90);
  const releasedMonth = rows.filter((r) => r._state === "released" && monthKey(releaseDate(r)) === m0);
  const since90 = addDays(today, -90);
  const recent = rows.filter((r) => r.sampling_date && r.sampling_date >= since90);
  const med = median(recent.map(totalDays));
  const oldest = (xs) => Math.max(0, ...xs.map((r) => daysBetween(r.sampling_date, today) || 0));
  const queue = rows.filter((r) => r._state === "awaiting_qc" || r._state === "awaiting_micro" || r._state === "awaiting_sample")
    .sort((a, b) => (a.sampling_date || a.entry_date || "") < (b.sampling_date || b.entry_date || "") ? -1 : 1);
  const recentOut = rows.filter((r) => r._state === "released").sort((a, b) => ((releaseDate(b) || "") > (releaseDate(a) || "") ? 1 : -1)).slice(0, 8);

  return (
    <>
      <div className="mt-kpis">
        <button className="mt-kpi amber" onClick={() => goList({ state: "awaiting_qc" })}><b>{waitingQc.length}</b><span>Waiting for QC</span><small>{waitingQc.length ? `oldest ${oldest(waitingQc)} day(s)` : "nothing waiting"}</small></button>
        <button className="mt-kpi blue" onClick={() => goList({ state: "awaiting_micro" })}><b>{waitingMicro.length}</b><span>Waiting for Microbiology</span><small>{waitingMicro.length ? `oldest ${oldest(waitingMicro)} day(s)` : "nothing waiting"}</small></button>
        <button className="mt-kpi green" onClick={() => goList({ state: "released", month: m0 })}><b>{releasedMonth.length}</b><span>Released this month</span><small>{monthLabel(m0)}</small></button>
        <button className="mt-kpi teal" onClick={() => goList({})}><b>{one(med)}</b><span>Median days to release</span><small>sampled in the last 90 days</small></button>
        <button className="mt-kpi rose" onClick={() => goList({ state: "problem" })}><b>{hold.length}</b><span>Not approved / on hold</span><small>last 90 days</small></button>
      </div>

      <div className="qc-pipe">
        {STAGE_KEYS.map((k, i) => {
          const st = STAGES[k]; const rs = rows.filter((r) => r.stage === k);
          const wq = rs.filter((r) => r._state === "awaiting_qc").length, wm = rs.filter((r) => r._state === "awaiting_micro").length;
          const rel = rs.filter((r) => r._state === "released" && monthKey(releaseDate(r)) === m0).length;
          const md = median(rs.filter((r) => r.sampling_date && r.sampling_date >= since90).map(totalDays));
          return (
            <button key={k} className="qc-stage" style={{ borderTopColor: st.color }} onClick={() => goList({ stage: k })}>
              {i > 0 && <span className="qc-arrow">›</span>}
              <div className="qc-stage-t">{st.icon} {st.title}</div>
              <div className="qc-stage-n">{wq + wm}<small> waiting</small></div>
              <div className="qc-stage-s">{st.hasMicro ? `${wq} QC · ${wm} Micro` : `${wq} QC`}</div>
              <div className="qc-stage-s">{rel} released this month</div>
              <div className="qc-stage-s">median {one(md)} day(s)</div>
            </button>);
        })}
      </div>

      <div className="qc-two">
        <div className="ipanel">
          <div className="ipanel-head"><div><h3>⏳ Waiting now</h3><p>Oldest first. Press “Record result” when the QC or Microbiology result is ready.{(() => { const n = queue.filter((r) => overdueDays(r, today) > 0).length; return n ? <b className="due-over"> {n} past the QC Head’s tentative date.</b> : null; })()}</p></div></div>
          {queue.length === 0 && <Empty>Nothing is waiting. 🎉</Empty>}
          {queue.slice(0, 12).map((r) => <QueueRow key={r.id} r={r} today={today} onOpen={onOpen} />)}
          {queue.length > 12 && <button className="link-btn" onClick={() => goList({ state: "waiting" })}>Show all {queue.length} →</button>}
        </div>
        <div className="ipanel">
          <div className="ipanel-head"><div><h3>✅ Released recently</h3></div></div>
          {recentOut.map((r) => (
            <button key={r.id} className="qc-row" onClick={() => onOpen(r)}>
              <span className="qc-dot" style={{ background: STAGES[r.stage].color }} />
              <span className="qc-row-main"><b>{r.item_name}</b><small>{[r.firm_id, r.batch_no && `batch ${r.batch_no}`, r.qc_report_no].filter(Boolean).join(" · ")}</small></span>
              <span className="qc-row-side">{fmtD(releaseDate(r))}<small>{one(totalDays(r), 0)} day(s)</small></span>
            </button>))}
        </div>
      </div>
    </>
  );
}

function QueueRow({ r, today, onOpen }) {
  const age = daysBetween(r.sampling_date || r.entry_date, today);
  const late = age != null && age >= 7;
  return (
    <div className="qc-row">
      <span className="qc-dot" style={{ background: STAGES[r.stage].color }} />
      <span className="qc-row-main">
        <b>{r.firm_id && <span className="tk-firm" style={{ background: FIRM_COLORS[r.firm_id] }}>{r.firm_id}</span>}{r.item_name}</b>
        <small>{STAGES[r.stage].short}{r.batch_no ? ` · batch ${r.batch_no}` : ""}{r.sampled_by ? ` · sampled by ${r.sampled_by}` : ""}</small>
      </span>
      {r.tentative_release_date && <span className={`qc-tent ${overdueDays(r, today) > 0 ? "late" : ""}`} title="Tentative date of release set by the QC Head">due {fmtD(r.tentative_release_date).slice(0, 5)}{overdueDays(r, today) > 0 ? ` · ${overdueDays(r, today)} d late` : ""}</span>}
      <span className="qc-pill" style={{ background: STATE_COLOR[r._state] }}>{STATE_LABEL[r._state]}</span>
      <span className={`qc-age ${late ? "late" : ""}`}>{age != null ? `${age} d` : ""}</span>
      <button className="btn-ghost sm" onClick={() => onOpen(r)}>Record result</button>
    </div>
  );
}

// ── Entries ──────────────────────────────────────────────────────────────
function Entries({ rows, preset, today, onOpen, onNew }) {
  const [stage, setStage] = useState(preset?.stage || "");
  const [firm, setFirm] = useState("");
  const [state, setState] = useState(preset?.state || "");
  const [month, setMonth] = useState(preset?.month || "");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  const months = useMemo(() => [...new Set(rows.map((r) => monthKey(r.entry_date)).filter(Boolean))].sort().reverse(), [rows]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (!stage || r.stage === stage) && (!firm || r.firm_id === firm)
      && (!state || (state === "waiting" ? isWaiting(r._state) : state === "problem" ? (r._state === "hold" || r._state === "rejected") : r._state === state))
      && (!month || (state === "released" && preset?.month === month ? monthKey(releaseDate(r)) === month : monthKey(r.entry_date) === month))
      && (!s || [r.item_name, r.batch_no, r.qc_report_no, r.micro_report_no, r.supplier, r.sampled_by, r.bill_no, r.notes].join(" ").toLowerCase().includes(s)))
      .sort((a, b) => ((b.entry_date || "") > (a.entry_date || "") ? 1 : (b.entry_date || "") < (a.entry_date || "") ? -1 : (b.created_at > a.created_at ? 1 : -1)));
  }, [rows, stage, firm, state, month, q, preset]);
  const counts = (k) => rows.filter((r) => r.stage === k).length;

  return (
    <>
      <div className="pg-search chk-noprint">
        <SearchBox value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="🔎 Search item, batch number, report number, supplier, who sampled…" />
        {q && <button className="btn-ghost" onClick={() => setQ("")}>Clear</button>}
      </div>
      <div className="mt-bar">
        <div className="seg">
          <button className={!stage ? "on" : ""} onClick={() => { setStage(""); setShown(PAGE); }}>All <span className="fcount">{rows.length}</span></button>
          {STAGE_KEYS.map((k) => <button key={k} className={stage === k ? "on" : ""} onClick={() => { setStage(k); setShown(PAGE); }}>{STAGES[k].icon} {STAGES[k].short} <span className="fcount">{counts(k)}</span></button>)}
        </div>
        <div className="qc-filters">
          <select className="inp inp-filter" value={firm} onChange={(e) => { setFirm(e.target.value); setShown(PAGE); }}><option value="">All firms</option>{FIRMS.map((f) => <option key={f}>{f}</option>)}</select>
          <select className="inp inp-filter" value={state} onChange={(e) => { setState(e.target.value); setShown(PAGE); }}>
            <option value="">Any status</option><option value="waiting">Waiting (any)</option>
            {Object.entries(STATE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="problem">Not approved / on hold</option>
          </select>
          <select className="inp inp-filter" value={month} onChange={(e) => { setMonth(e.target.value); setShown(PAGE); }}><option value="">All months</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
          <button className="btn-ghost" onClick={() => exportCsv(list)}>⬇ Excel</button>
          <button className="btn-primary" onClick={() => onNew(stage || "fp")}>＋ New entry</button>
        </div>
      </div>
      <div className="small-muted" style={{ margin: "6px 2px" }}>{list.length} record{list.length === 1 ? "" : "s"}</div>

      {list.length === 0 ? <Empty>No records match.</Empty> : (
        <div className="table-wrap">
          <table className="tbl qc-tbl">
            <thead><tr><th>Date</th><th>Item</th><th>Batch / supplier</th><th>Sampled</th><th>QC</th><th>Micro</th><th>Status</th><th>Days</th></tr></thead>
            <tbody>
              {list.slice(0, shown).map((r) => {
                const age = daysBetween(r.sampling_date || r.entry_date, today);
                return (
                  <tr key={r.id} className="qc-tr" onClick={() => onOpen(r)}>
                    <td className="nowrap">{fmtD(r.entry_date)}</td>
                    <td><span className="qc-dot" style={{ background: STAGES[r.stage].color }} />{r.firm_id && <span className="tk-firm" style={{ background: FIRM_COLORS[r.firm_id] }}>{r.firm_id}</span>}<b>{r.item_name}</b>{r.batch_id && <span className="qc-tent" title="Comes from Batch Detail" style={{ marginLeft: 6 }}>🏭</span>}{r.qty && <small className="qc-sub"> {r.qty}</small>}
                      {(r.import_flags || []).length > 0 && !r.review_done && <span title={r.import_flags.join("\n")} className="qc-flag">⚠</span>}</td>
                    <td>{r.batch_no || r.supplier || "—"}{r.batch_no && r.supplier ? <small className="qc-sub"> {r.supplier}</small> : null}</td>
                    <td className="nowrap">{fmtD(r.sampling_date) || "—"}{r.sample_received_time && <small className="qc-sub"> {fmtT(r.sample_received_time)}</small>}{r.sampled_by && <small className="qc-sub"> {r.sampled_by}</small>}</td>
                    <td className="nowrap">{r.qc_release_date ? fmtD(r.qc_release_date) : r.tentative_release_date ? <span className={overdueDays(r, today) > 0 && isWaiting(r._state) ? "due-over" : "qc-sub"}>due {fmtD(r.tentative_release_date).slice(0, 5)}</span> : "—"}{r.qc_report_no && <small className="qc-sub"> {r.qc_report_no}</small>}</td>
                    <td className="nowrap">{STAGES[r.stage].hasMicro || r.micro_release_date ? (r.micro_release_date ? fmtD(r.micro_release_date) : r.micro_remarks || "—") : <span className="small-muted">n/a</span>}</td>
                    <td><span className="qc-pill" style={{ background: STATE_COLOR[r._state] }}>{STATE_LABEL[r._state]}</span></td>
                    <td className="nowrap">{r._state === "released" ? one(totalDays(r), 0) : isWaiting(r._state) && age != null ? <span className={age >= 7 ? "due-over" : ""}>{age}</span> : ""}</td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>
      )}
      {list.length > shown && <div style={{ textAlign: "center", marginTop: 12 }}><button className="btn-ghost" onClick={() => setShown((n) => n + PAGE * 3)}>Show more ({list.length - shown} left)</button></div>}
    </>
  );
}

function exportCsv(list) {
  const head = ["Stage", "Firm", "Date", "Item", "Quantity / batch size", "Batch no", "Mfg", "Exp", "Supplier", "Containers", "Bill no", "Sampling date", "Time received by QC", "Sampled by", "Tentative release", "QC release", "QC report", "QC remarks", "Assay", "Water/LOD", "Micro release", "Micro report", "Micro remarks", "Control release", "Final release", "Notes"];
  const lines = list.map((r) => [STAGES[r.stage].title, r.firm_id, fmtD(r.entry_date), r.item_name, r.qty, r.batch_no, fmtM(r.mfg), fmtM(r.exp), r.supplier, r.containers, r.bill_no, fmtD(r.sampling_date), fmtT(r.sample_received_time), r.sampled_by, fmtD(r.tentative_release_date), fmtD(r.qc_release_date), r.qc_report_no, r.qc_remarks, r.assay, r.water_lod, fmtD(r.micro_release_date), r.micro_report_no, r.micro_remarks, fmtD(r.control_release_date), fmtD(r.final_release_date), r.notes]
    .map((v) => { let t = String(v ?? ""); if (/^[=+\-@]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; }).join(","));
  const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `qc-release-${todayISO()}.csv`; a.click();
}

// ── Add / record result / edit ───────────────────────────────────────────
const FIELDS = ["firm_id", "entry_date", "item_name", "qty", "containers", "supplier", "bill_no", "bill_date", "batch_no", "mfg", "exp", "sampling_date", "sample_received_time", "sampled_by", "tentative_release_date",
  "qc_release_date", "qc_report_no", "qc_remarks", "assay", "water_lod", "micro_release_date", "micro_report_no", "micro_remarks", "control_release_date", "final_release_date", "notes"];

function EntryForm({ row, stage: stage0, rows, onClose, onSaved }) {
  const { isOwner, profiles, batches } = useData();
  const isNew = !row;
  const batch = row?.batch_id ? batches.rows.find((b) => b.id === row.batch_id) : null;
  const locked = !!batch; // item, batch, firm and dates come from Batch Detail
  const sibs = batch ? batches.rows.filter((b) => !b.deleted_at && b.id !== batch.id && b.firm_id === batch.firm_id && b.kind === batch.kind && b.group_no === batch.group_no && b.series_year === batch.series_year) : [];
  const bulkRow = batch ? rows.find((r) => r.stage === "bulk" && normBatch(r.batch_no) === normBatch(batch.group_no) && (r.mfg || "").slice(0, 7) === (batch.mfg || "").slice(0, 7)) : null;
  const [stage, setStage] = useState(row?.stage || stage0 || "fp");
  const [f, setF] = useState(() => { const o = {}; FIELDS.forEach((k) => { o[k] = row?.[k] ?? ""; }); if (isNew) o.entry_date = todayISO(); return o; });
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();
  const st = STAGES[stage];
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setM = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value ? `${e.target.value}-01` : "" }));

  const sameStage = rows.filter((r) => r.stage === stage);
  const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const items = useMemo(() => uniq(sameStage.map((r) => r.item_name)), [rows, stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const suppliers = useMemo(() => uniq(rows.map((r) => r.supplier)), [rows]);
  const people = useMemo(() => uniq([...rows.map((r) => r.sampled_by), ...profiles.rows.filter((p) => p.status === "approved" && (p.qc_access || p.role !== "member")).map((p) => p.full_name)]), [rows, profiles.rows]);
  const brandFirm = (name) => { const hit = rows.find((r) => r.stage === "fp" && r.firm_id && r.item_name.toLowerCase() === name.trim().toLowerCase()); return hit?.firm_id || ""; };

  const warns = warningsFor(f);
  const dupReport = f.qc_report_no.trim() && rows.some((r) => r.id !== row?.id && r.stage === stage && (r.qc_report_no || "").toLowerCase() === f.qc_report_no.trim().toLowerCase() && (stage !== "fp" || r.firm_id === (f.firm_id || null)));
  const dupBatch = f.batch_no.trim() && rows.some((r) => r.id !== row?.id && r.stage === stage && (r.batch_no || "").toLowerCase() === f.batch_no.trim().toLowerCase() && r.item_name.toLowerCase() === f.item_name.trim().toLowerCase());

  const save = async () => {
    if (busy) return;
    if (!f.item_name.trim()) { toast(`Type the ${st.item.toLowerCase()} name first.`, "err"); return; }
    if (!f.entry_date) { toast("Choose the date.", "err"); return; }
    if (stage === "fp" && !f.firm_id) { toast("Choose the firm (VP or VH) for a finished product.", "err"); return; }
    setBusy(true);
    const payload = { stage };
    FIELDS.forEach((k) => { const v = typeof f[k] === "string" ? f[k].trim() : f[k]; payload[k] = v === "" ? null : v; });
    if (payload.containers != null) payload.containers = parseInt(payload.containers, 10) || null;
    if (!isNew) payload.review_done = true;   // anything saved by hand has been looked at
    const r = isNew
      ? await run(supabase.from("hub_qc_releases").insert(payload), "Entry saved")
      : await run(supabase.from("hub_qc_releases").update(payload).eq("id", row.id), "Saved");
    setBusy(false);
    if (r.ok) { onSaved(); onClose(); }
  };
  const remove = async () => {
    if (!(await ask({ title: "Delete this entry?", body: `${row.item_name} will move to the recycle bin (owners can restore it from Admin).`, okText: "Delete", danger: true }))) return;
    const r = await run(supabase.from("hub_qc_releases").update({ deleted_at: new Date().toISOString() }).eq("id", row.id), "Deleted");
    if (r.ok) { onSaved(); onClose(); }
  };

  const dateField = (k, label, hint) => <Field label={label} hint={hint}><input className="form-inp" type="date" value={f[k] || ""} onChange={set(k)} /></Field>;
  const monthField = (k, label) => <Field label={label}><input className="form-inp" type="month" disabled={locked && (k === "mfg" || k === "exp")} value={f[k] ? f[k].slice(0, 7) : ""} onChange={setM(k)} /></Field>;
  const remarkField = (k, label) => <Field label={label}><select className="form-inp" value={f[k] || ""} onChange={set(k)}><option value="">— waiting —</option>{REMARKS.map((x) => <option key={x}>{x}</option>)}</select></Field>;

  return (
    <Modal title={isNew ? "New QC entry" : `${st.title}: ${row.item_name}`} onClose={onClose} wide
      actions={<>{!isNew && isOwner && <button className="btn-danger" onClick={remove} style={{ marginRight: "auto" }}>Delete</button>}
        <button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      {isNew && (
        <div className="seg" style={{ marginBottom: 12 }}>
          {STAGE_KEYS.map((k) => <button key={k} className={stage === k ? "on" : ""} onClick={() => setStage(k)}>{STAGES[k].icon} {STAGES[k].title}</button>)}
        </div>)}

      {batch && (
        <div className="bd-split" style={{ marginBottom: 10 }}>
          <b>🏭 From Production (Batch Detail)</b>
          <div className="small-muted">Product, batch number, firm and dates are set in Batch Detail, so they are locked here.</div>
          <div className="small-muted">{[batch.pack_size, batch.mrp != null && `MRP ₹${batch.mrp}`, batch.pieces != null && `${batch.pieces.toLocaleString("en-IN")} pcs`, batch.batch_size != null && `${Number(batch.batch_size)} ${batch.batch_size_unit || ""}`, batch.market].filter(Boolean).join(" · ")}</div>
          {sibs.length > 0 && <div className="small-muted">Same lot also filled as: {sibs.map((x) => `${x.batch_no} ${x.product_name}`).join("; ")}</div>}
          {bulkRow && <div className="small-muted">Bulk batch {bulkRow.batch_no} in QC: {STATE_LABEL[stateOf(bulkRow)]}</div>}
        </div>)}
      <div className="qc-sec">1 · {stage === "bulk" || stage === "fp" ? "Production" : "Received"}</div>
      <div className="form-grid">
        <Field label={stage === "fp" ? "Firm (required)" : "Firm (optional)"}>
          <select className="form-inp" disabled={locked} value={f.firm_id || ""} onChange={set("firm_id")}><option value="">{stage === "fp" ? "Choose…" : "Not decided / both"}</option>{FIRMS.map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
        {dateField("entry_date", stage === "raw" || stage === "packing" ? "Date received" : "Date")}
        <Field label={stage === "fp" ? "Batch size" : "Quantity"}><input className="form-inp" value={f.qty || ""} onChange={set("qty")} placeholder={stage === "raw" ? "e.g. 25 kg" : stage === "packing" ? "e.g. 10500" : "e.g. 100 kg"} /></Field>
      </div>
      <Field label={st.item}>
        <input className="form-inp" disabled={locked} list="qc-items" value={f.item_name} onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, item_name: v, firm_id: stage === "fp" && !x.firm_id ? brandFirm(v) : x.firm_id })); }} placeholder="Type or pick from the list…" />
        <datalist id="qc-items">{items.map((x) => <option key={x} value={x} />)}</datalist>
      </Field>
      <div className="form-grid">
        {(stage === "raw" || stage === "packing") && <Field label="Supplier"><input className="form-inp" list="qc-suppliers" value={f.supplier || ""} onChange={set("supplier")} /><datalist id="qc-suppliers">{suppliers.map((x) => <option key={x} value={x} />)}</datalist></Field>}
        {(stage === "raw" || stage === "packing") && <Field label="No. of containers"><input className="form-inp" type="number" min="0" value={f.containers ?? ""} onChange={set("containers")} /></Field>}
        {stage === "packing" && <Field label="Bill no."><input className="form-inp" value={f.bill_no || ""} onChange={set("bill_no")} /></Field>}
        {stage === "packing" && dateField("bill_date", "Bill date")}
        {stage !== "packing" && <Field label="Batch no."><input className="form-inp" disabled={locked} value={f.batch_no || ""} onChange={set("batch_no")} /></Field>}
        {stage !== "packing" && monthField("mfg", "Mfg (month)")}
        {stage !== "packing" && monthField("exp", "Exp (month)")}
      </div>
      {dupBatch && <div className="mt-dup">⚠️ This batch number is already recorded for {f.item_name.trim()}.</div>}

      <div className="qc-sec">2 · Sampling</div>
      <div className="form-grid">
        {dateField("sampling_date", "Sampling date")}
        <Field label="Time received by QC"><input className="form-inp" type="time" value={f.sample_received_time ? String(f.sample_received_time).slice(0, 5) : ""} onChange={set("sample_received_time")} /></Field>
        {stage === "fp" && dateField("tentative_release_date", "Tentative date of release", "Set by the QC Head when the sample is handed over. It can differ from the actual date.")}
        <Field label="Sampled by"><input className="form-inp" list="qc-people" value={f.sampled_by || ""} onChange={set("sampled_by")} /><datalist id="qc-people">{people.map((x) => <option key={x} value={x} />)}</datalist></Field>
      </div>

      <div className="qc-sec">3 · QC result</div>
      <div className="form-grid">
        {dateField("qc_release_date", "QC release date")}
        <Field label="QC report no."><input className="form-inp" value={f.qc_report_no || ""} onChange={set("qc_report_no")} placeholder={stage === "raw" ? "RM25…" : stage === "packing" ? "PM25…" : stage === "bulk" ? "BK25…" : "FP25…"} /></Field>
        {remarkField("qc_remarks", "QC remark")}
        {stage === "raw" && <Field label="Assay"><input className="form-inp" value={f.assay || ""} onChange={set("assay")} placeholder="e.g. 99.5%" /></Field>}
        {stage === "raw" && <Field label="Water / LOD"><input className="form-inp" value={f.water_lod || ""} onChange={set("water_lod")} placeholder="e.g. 0.2%" /></Field>}
      </div>
      {dupReport && <div className="mt-dup">⚠️ This QC report number is already used{stage === "fp" ? " for this firm" : ""}.</div>}

      {(st.hasMicro || stage === "raw") && <>
        <div className="qc-sec">4 · Microbiology result{stage === "raw" ? " (only if tested)" : ""}</div>
        <div className="form-grid">
          {dateField("micro_release_date", "Micro release date")}
          {stage !== "fp" && <Field label="Micro report no."><input className="form-inp" value={f.micro_report_no || ""} onChange={set("micro_report_no")} /></Field>}
          {remarkField("micro_remarks", "Micro remark")}
        </div>
      </>}
      {stage === "fp" && <>
        <div className="qc-sec">5 · Final release</div>
        <div className="form-grid">
          {f.firm_id === "VH" && dateField("control_release_date", "Control sample release")}
          {dateField("final_release_date", "Date of release")}
        </div>
      </>}

      <Field label="Notes"><textarea className="form-inp" value={f.notes || ""} onChange={set("notes")} /></Field>
      {warns.length > 0 && <div className="mt-dup">{warns.map((w) => <div key={w}>⚠️ {w}</div>)}</div>}
      {!isNew && (row.import_flags || []).length > 0 && <div className="small-muted" style={{ marginTop: 8 }}>Flagged when imported: {row.import_flags.join("; ")}. Saving marks it as checked.</div>}
      {dialog}
    </Modal>
  );
}

// ── Insights ─────────────────────────────────────────────────────────────
function Insights({ rows, today, isOwner }) {
  const [firm, setFirm] = useState("");
  const base = rows.filter((r) => !firm || r.firm_id === firm || (!r.firm_id && r.stage !== "fp"));
  const months = lastMonths(12);

  const volume = months.map((m) => ({ label: monthLabel(m), values: Object.fromEntries(STAGE_KEYS.map((k) => [k, base.filter((r) => r.stage === k && monthKey(r.entry_date) === m).length])) }));
  const lines = STAGE_KEYS.map((k) => ({ name: STAGES[k].title, color: STAGES[k].color, points: months.map((m) => median(base.filter((r) => r.stage === k && monthKey(r.sampling_date) === m).map(totalDays))) }));

  const supp = (stage) => {
    const g = {};
    base.filter((r) => r.stage === stage && r.supplier).forEach((r) => { (g[r.supplier] ||= []).push(r); });
    return Object.entries(g).map(([name, rs]) => ({ name, lots: rs.length, ok: rs.filter((r) => r.qc_remarks === "Approved").length, bad: rs.filter((r) => r.qc_remarks === "Not approved").length, med: median(rs.map(qcDays)), last: rs.map((r) => r.entry_date).filter(Boolean).sort().pop() }))
      .sort((a, b) => b.lots - a.lots).slice(0, 10);
  };
  const prod = (stage) => {
    const g = {};
    base.filter((r) => r.stage === stage).forEach((r) => { (g[r.item_name] ||= []).push(r); });
    return Object.entries(g).map(([name, rs]) => ({ name, n: rs.length, med: median(rs.map(totalDays)), last: rs.map((r) => r.entry_date).filter(Boolean).sort().pop(), firms: [...new Set(rs.map((r) => r.firm_id).filter(Boolean))].join("/") }))
      .sort((a, b) => b.n - a.n).slice(0, 10);
  };
  const since90 = addDays(today, -90);
  const people = {};
  rows.filter((r) => r.sampled_by && r.sampling_date && r.sampling_date >= since90).forEach((r) => { people[r.sampled_by] = (people[r.sampled_by] || 0) + 1; });
  const peopleList = Object.entries(people).sort((a, b) => b[1] - a[1]);
  const maxP = Math.max(1, ...peopleList.map((p) => p[1]));
  const slow = base.filter((r) => r.sampling_date && r.sampling_date >= since90 && totalDays(r) != null).sort((a, b) => totalDays(b) - totalDays(a)).slice(0, 8);

  return (
    <>
      <div className="mt-bar"><div className="small-muted">Charts use the date received / sampled. Finished products are split by firm; raw, packing and bulk are shared.</div>
        <select className="inp inp-filter" value={firm} onChange={(e) => setFirm(e.target.value)}><option value="">All firms</option>{FIRMS.map((f) => <option key={f}>{f}</option>)}</select></div>

      <div className="ipanel">
        <div className="ipanel-head"><div><h3>📦 Records per month</h3><p>How many items were logged each month, by stage. Last 12 months.</p></div></div>
        <StackedBars data={volume} />
        <div className="qc-legend">{STAGE_KEYS.map((k) => <span key={k}><i style={{ background: STAGES[k].color }} />{STAGES[k].title}</span>)}</div>
      </div>

      <div className="ipanel">
        <div className="ipanel-head"><div><h3>⏱️ Days from sampling to release</h3><p>Median per month. A lower line is faster. Use it to agree a release-time target with the team.</p></div></div>
        <LineChart series={lines} labels={months.map(monthLabel)} />
        <div className="qc-legend">{lines.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
      </div>

      <div className="qc-two">
        {["raw", "packing"].map((k) => (
          <div className="ipanel" key={k}>
            <div className="ipanel-head"><div><h3>{STAGES[k].icon} {STAGES[k].title}: suppliers</h3><p>Lots received, how many approved, median days to QC release.</p></div></div>
            <div className="table-wrap"><table className="tbl"><thead><tr><th>Supplier</th><th>Lots</th><th>Approved</th><th>QC days</th><th>Last</th></tr></thead><tbody>
              {supp(k).map((s) => <tr key={s.name}><td>{s.name}</td><td>{s.lots}</td><td>{Math.round((100 * s.ok) / Math.max(1, s.lots))}%{s.bad ? <span className="due-over"> · {s.bad} rejected</span> : ""}</td><td>{one(s.med)}</td><td className="nowrap">{fmtD(s.last)}</td></tr>)}
            </tbody></table></div>
          </div>))}
      </div>

      <div className="qc-two">
        {["fp", "bulk"].map((k) => (
          <div className="ipanel" key={k}>
            <div className="ipanel-head"><div><h3>{STAGES[k].icon} {k === "fp" ? "Finished products" : "Bulk"}: most batches</h3><p>Batches logged, median days to release.</p></div></div>
            <div className="table-wrap"><table className="tbl"><thead><tr><th>{k === "fp" ? "Brand" : "Generic name"}</th><th>Batches</th><th>Days</th><th>Last</th></tr></thead><tbody>
              {prod(k).map((s) => <tr key={s.name}><td>{s.firms && <span className="small-muted">{s.firms} · </span>}{s.name}</td><td>{s.n}</td><td>{one(s.med)}</td><td className="nowrap">{fmtD(s.last)}</td></tr>)}
            </tbody></table></div>
          </div>))}
      </div>

      <TentativePanel rows={base} today={today} />

      <div className="ipanel">
        <div className="ipanel-head"><div><h3>🐢 Slowest releases, last 90 days</h3><p>The batches that took longest from sampling to release.</p></div></div>
        {slow.length === 0 && <Empty>No data in the last 90 days.</Empty>}
        {slow.map((r) => <div key={r.id} className="qc-row"><span className="qc-dot" style={{ background: STAGES[r.stage].color }} /><span className="qc-row-main"><b>{r.item_name}</b><small>{[STAGES[r.stage].short, r.firm_id, r.batch_no && `batch ${r.batch_no}`].filter(Boolean).join(" · ")}</small></span><span className="qc-row-side">{totalDays(r)} days<small>sampled {fmtD(r.sampling_date)}</small></span></div>)}
      </div>

      {isOwner && (
        <div className="ipanel">
          <div className="ipanel-head"><div><h3>👥 Samples taken, last 90 days (owners only)</h3><p>Who logged the sampling. Shown to owners only.</p></div></div>
          {peopleList.map(([n, c]) => <div key={n} className="mt-hbar"><span>{n}</span><div><i style={{ width: `${(100 * c) / maxP}%`, background: "#1a6fa8" }} /></div><b>{c}</b></div>)}
        </div>)}
    </>
  );
}

// finished products: the QC Head's tentative date of release against the actual release
function TentativePanel({ rows, today }) {
  const since = addDays(today, -90);
  const done = rows.filter((r) => r.stage === "fp" && r.tentative_release_date && r.sampling_date && r.sampling_date >= since && tentativeGap(r) != null);
  const open = rows.filter((r) => r.stage === "fp" && isWaiting(r._state) && overdueDays(r, today) > 0);
  const onTime = done.filter((r) => tentativeGap(r) <= 0).length;
  const late = done.filter((r) => tentativeGap(r) > 0);
  const gaps = done.map(tentativeGap);
  const buckets = [["Earlier than planned", (g) => g < 0], ["On the planned day", (g) => g === 0], ["1 to 2 days late", (g) => g >= 1 && g <= 2], ["3 or more days late", (g) => g >= 3]].map(([l, f]) => [l, gaps.filter(f).length]);
  const max = Math.max(1, ...buckets.map((b) => b[1]));
  return (
    <div className="ipanel">
      <div className="ipanel-head"><div><h3>🎯 Tentative date against actual release</h3><p>Finished products sampled in the last 90 days that had a tentative date of release.</p></div></div>
      {done.length === 0 ? <Empty>No finished product has both a tentative and an actual release date yet. Enter the tentative date when the sample is handed over.</Empty> : (
        <>
          <div className="qc-facts">
            <div><b>{Math.round((100 * onTime) / done.length)}%</b><span>released on or before the tentative date ({onTime} of {done.length})</span></div>
            <div><b>{one(avg(late.map(tentativeGap)))}</b><span>days late on average, for the {late.length} that were late</span></div>
            <div><b>{open.length}</b><span>still waiting past their tentative date</span></div>
          </div>
          {buckets.map(([l, c]) => <div key={l} className="mt-hbar" style={{ gridTemplateColumns: "150px 1fr 34px" }}><span>{l}</span><div><i style={{ width: `${(100 * c) / max}%`, background: l.includes("late") ? "#dc2626" : "#16a34a" }} /></div><b>{c}</b></div>)}
        </>)}
    </div>
  );
}

function StackedBars({ data }) {
  const W = 680, H = 210, pl = 30, pb = 26, pt = 8;
  const max = Math.max(5, ...data.map((d) => STAGE_KEYS.reduce((s, k) => s + d.values[k], 0)));
  const bw = (W - pl) / data.length;
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="qc-svg" role="img" aria-label="Records per month by stage">
      {ticks.map((t) => { const y = pt + (H - pb - pt) * (1 - t / max); return <g key={t}><line x1={pl} x2={W} y1={y} y2={y} stroke="#e5e7eb" /><text x={pl - 4} y={y + 3} textAnchor="end" fontSize="10" fill="#6b7280">{t}</text></g>; })}
      {data.map((d, i) => {
        let y = H - pb; const x = pl + i * bw + bw * 0.18;
        return (
          <g key={d.label}>
            {STAGE_KEYS.map((k) => { const h = ((H - pb - pt) * d.values[k]) / max; y -= h; return h > 0 ? <rect key={k} x={x} y={y} width={bw * 0.64} height={h} fill={STAGES[k].color}><title>{`${d.label} · ${STAGES[k].title}: ${d.values[k]}`}</title></rect> : null; })}
            <text x={x + bw * 0.32} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7280">{d.label.slice(0, 3)}</text>
          </g>);
      })}
    </svg>
  );
}

function LineChart({ series, labels }) {
  const W = 680, H = 210, pl = 30, pb = 26, pt = 10;
  const vals = series.flatMap((s) => s.points).filter((v) => v != null);
  const max = Math.max(4, Math.ceil(Math.max(0, ...vals)));
  const step = (W - pl - 10) / Math.max(1, labels.length - 1);
  const X = (i) => pl + 5 + i * step, Y = (v) => pt + (H - pb - pt) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="qc-svg" role="img" aria-label="Median days from sampling to release per month">
      {[0, 0.5, 1].map((t) => { const v = Math.round(max * t); return <g key={t}><line x1={pl} x2={W} y1={Y(v)} y2={Y(v)} stroke="#e5e7eb" /><text x={pl - 4} y={Y(v) + 3} textAnchor="end" fontSize="10" fill="#6b7280">{v}</text></g>; })}
      {series.map((s) => {
        const pts = s.points.map((v, i) => (v == null ? null : [X(i), Y(v), v]));
        const path = pts.reduce((d, p, i) => (p ? `${d}${pts[i - 1] ? "L" : "M"}${p[0]},${p[1]} ` : d), "");
        return <g key={s.name}><path d={path} fill="none" stroke={s.color} strokeWidth="2.2" />{pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={s.color}><title>{`${labels[i]} · ${s.name}: ${one(p[2])} days`}</title></circle>)}</g>;
      })}
      {labels.map((l, i) => <text key={l} x={X(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7280">{l.slice(0, 3)}</text>)}
    </svg>
  );
}

// ── Data check (owners) ──────────────────────────────────────────────────
function DataCheck({ rows, onOpen, reload }) {
  const flagged = rows.filter((r) => ((r.import_flags || []).length || r._state === "incomplete") && !r.review_done).map((r) => ((r.import_flags || []).length ? r : { ...r, import_flags: ["no sampling date recorded"] }));
  const imported = rows.filter((r) => r.legacy_ref).length;
  const [prev, setPrev] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [fileErr, setFileErr] = useState("");

  const onFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setFileErr(""); setPrev(null); setDone(null);
    try {
      const XLSX = await import("xlsx");
      const res = readOldSheet(XLSX, new Uint8Array(await file.arrayBuffer()));
      if (!res.rows.length) { setFileErr("No records found. Is this the Material Release Table (Excel)?"); return; }
      setPrev(res);
    } catch (err) { setFileErr("That file could not be read. Download the sheet as Excel (.xlsx) and try again."); console.error(err); }
  };
  const doImport = async () => {
    setBusy(true); let added = 0;
    for (let i = 0; i < prev.rows.length; i += 200) {
      const { data, error } = await supabase.from("hub_qc_releases").upsert(prev.rows.slice(i, i + 200), { onConflict: "legacy_ref", ignoreDuplicates: true }).select("id");
      if (error) { toast(error.message, "err"); setBusy(false); reload(); return; }
      added += data.length;
    }
    setBusy(false); setDone({ added, total: prev.rows.length }); setPrev(null); reload();
    toast(`${added} records imported`);
  };
  const reviewed = async (r) => { const x = await run(supabase.from("hub_qc_releases").update({ review_done: true }).eq("id", r.id), "Marked as checked"); if (x.ok) reload(); };

  const by = prev ? STAGE_KEYS.map((k) => [STAGES[k].title, prev.rows.filter((r) => r.stage === k).length]) : [];
  return (
    <>
      <div className="ipanel">
        <div className="ipanel-head"><div><h3>📥 Bring in the old sheet (one time)</h3>
          <p>In Google Sheets: File → Download → Microsoft Excel (.xlsx). Choose that file here. Records already imported are skipped, so it is safe to repeat. {imported ? `${imported} imported records are in the Hub now.` : "Nothing has been imported yet."}</p></div></div>
        <input type="file" accept=".xlsx" onChange={onFile} />
        {fileErr && <div className="mt-dup">{fileErr}</div>}
        {prev && (
          <div style={{ marginTop: 12 }}>
            <div><b>{prev.rows.length}</b> records found: {by.map(([n, c]) => `${n} ${c}`).join(" · ")}</div>
            <div className="small-muted">{prev.rows.filter((r) => (r.import_flags || []).length).length} have a note to check (odd dates and similar). Names were tidied so each supplier, person and item has one spelling. Finished products are tagged VP / VH from their tab; raw, packing and bulk have no firm in the old sheet.</div>
            <button className="btn-primary" style={{ marginTop: 10 }} onClick={doImport} disabled={busy}>{busy ? "Importing… please wait" : `Import ${prev.rows.length} records`}</button>
          </div>)}
        {done && <div className="mt-dup" style={{ background: "#ecfdf5", color: "#166534" }}>✅ Imported {done.added} of {done.total} ({done.total - done.added} were already there).</div>}
      </div>

      <div className="ipanel">
        <div className="ipanel-head"><div><h3>🔍 Records to check <span className="section-count">{flagged.length}</span></h3><p>Odd dates found when the sheet was imported (for example a typed year of 225, or a release dated before sampling). Open one, correct it and save.</p></div></div>
        {flagged.length === 0 && <Empty>Nothing to check. 👍</Empty>}
        {flagged.slice(0, 60).map((r) => (
          <div key={r.id} className="qc-row">
            <span className="qc-dot" style={{ background: STAGES[r.stage].color }} />
            <span className="qc-row-main"><b>{r.item_name}</b><small>{STAGES[r.stage].short} · {fmtD(r.entry_date) || "no date"} · {r.import_flags.join("; ")}</small></span>
            <button className="btn-ghost sm" onClick={() => onOpen(r)}>Open</button>
            <button className="btn-ghost sm" onClick={() => reviewed(r)}>It is fine</button>
          </div>))}
        {flagged.length > 60 && <div className="small-muted">+{flagged.length - 60} more</div>}
      </div>
    </>
  );
}
