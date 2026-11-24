import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { Modal, Field, Empty, SearchBox, useConfirm } from "../components/ui";
import { FIRM_COLORS } from "./compliance/common";
import { fmtD, todayISO } from "../lib/qc";
import { DEFAULT_TEMPLATE, TEMPLATE_KEY, FIRM_NAMES, buildMsds, reviewNotes, toDocx, splitIngredientList, parseApprovalText } from "../lib/msds";

// Regulatory: ingredient library (from supplier MSDS), product formulas, and the MSDS maker. Built as sections (tabs) so more regulatory
// work (licences, label checks, dossiers) can be added later without touching what is here.

const FIRMS = ["VH", "VP", "VI", "VS"];
const lst = (s) => String(s || "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
const val = (o, k) => (o && o[k] != null ? o[k] : "");

async function openRegFile(path) {
  const { data, error } = await supabase.storage.from("regulatory").createSignedUrl(path, 300);
  if (error) { toast(error.message, "err"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

function useSetting(key) {
  const [v, setV] = useState(undefined);
  const load = async () => { const { data } = await supabase.from("reg_settings").select("value").eq("key", key).maybeSingle(); setV(data?.value ?? null); };
  useEffect(() => { load(); }, [key]); // eslint-disable-line
  return [v, load];
}

export default function Regulatory() {
  const { regIngredients, regProducts, isOwner } = useData();
  const [view, setView] = useState("overview");
  const ings = useMemo(() => regIngredients.rows.filter((r) => !r.deleted_at), [regIngredients.rows]);
  const prods = useMemo(() => regProducts.rows.filter((r) => !r.deleted_at), [regProducts.rows]);
  const tabs = [["overview", "🏠 Overview"], ["ingredients", `🧪 Ingredients (${ings.length})`], ["products", `🧴 Products & formulas (${prods.length})`], ["msds", "📄 MSDS"], ...(isOwner ? [["settings", "⚙️ Settings"]] : [])];
  return (
    <div className="section qcp">
      <div className="mt-hero rg-hero"><div><div className="mt-hero-title">📋 Regulatory</div>
        <div className="mt-hero-sub">Ingredient data from supplier MSDS · product formulas · MSDS for Velite products (PDF and Word)</div></div></div>
      <div className="tk-views qc-tabs">{tabs.map(([k, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}</div>
      {view === "overview" ? <Overview ings={ings} prods={prods} go={setView} />
        : view === "ingredients" ? <Ingredients rows={ings} reload={regIngredients.reload} />
        : view === "products" ? <Products rows={prods} ings={ings} reload={regProducts.reload} />
        : view === "msds" ? <MsdsList prods={prods} ings={ings} />
        : <Settings reload={() => { regIngredients.reload(); regProducts.reload(); }} />}
    </div>
  );
}

// ── overview ─────────────────────────────────────────────────────────────
function Overview({ ings, prods, go }) {
  const [lineCount, setLineCount] = useState({}); const [sheets, setSheets] = useState([]);
  useEffect(() => {
    supabase.from("reg_formula_lines").select("product_id,pct,pct_text,ingredient_id").limit(20000).then(({ data }) => {
      const m = {}; (data || []).forEach((l) => { const c = (m[l.product_id] ||= { n: 0, noPct: 0, unlinked: 0 }); c.n++; if (l.pct == null && !l.pct_text) c.noPct++; if (!l.ingredient_id) c.unlinked++; }); setLineCount(m);
    });
    supabase.from("reg_msds").select("id,product_id,version,status,review_due,approved_on").then(({ data }) => setSheets(data || []));
  }, []);
  const noFormula = prods.filter((p) => !lineCount[p.id]);
  const withMsds = new Set(sheets.filter((s) => s.status === "approved").map((s) => s.product_id));
  const noMsds = prods.filter((p) => lineCount[p.id] && !withMsds.has(p.id));
  const due = sheets.filter((s) => s.status === "approved" && s.review_due && s.review_due <= new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10));
  const review = ings.filter((i) => i.status !== "verified");
  const Card = ({ n, t, c, onClick }) => <button className={`mt-kpi ${c}`} onClick={onClick}><b>{n}</b><span>{t}</span></button>;
  return (
    <>
      <div className="mt-kpis" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <Card n={ings.length} t="ingredients in the library" c="teal" onClick={() => go("ingredients")} />
        <Card n={review.length} t="ingredients to verify" c="amber" onClick={() => go("ingredients")} />
        <Card n={prods.length} t="products" c="blue" onClick={() => go("products")} />
        <Card n={noFormula.length} t="products without a formula" c="rose" onClick={() => go("products")} />
        <Card n={sheets.filter((s) => s.status === "approved").length} t="approved MSDS" c="green" onClick={() => go("msds")} />
      </div>
      <div className="ipanel"><div className="ipanel-head"><div><h3>What to do next</h3></div></div>
        {noFormula.length > 0 && <div className="qc-row"><span className="qc-row-main"><b>{noFormula.length} products have no formula yet</b><small>Open a product and paste its ingredient list from the FDA approval.</small></span><button className="btn-ghost sm" onClick={() => go("products")}>Open</button></div>}
        {noMsds.length > 0 && <div className="qc-row"><span className="qc-row-main"><b>{noMsds.length} products with a formula have no approved MSDS</b><small>Start the sheet from the MSDS tab.</small></span><button className="btn-ghost sm" onClick={() => go("msds")}>Open</button></div>}
        {review.length > 0 && <div className="qc-row"><span className="qc-row-main"><b>{review.length} ingredients are marked “to verify”</b><small>Compare each with its supplier MSDS, then tick Verified.</small></span><button className="btn-ghost sm" onClick={() => go("ingredients")}>Open</button></div>}
        {due.length > 0 && <div className="qc-row"><span className="qc-row-main"><b>{due.length} approved MSDS are due for review within 60 days</b></span><button className="btn-ghost sm" onClick={() => go("msds")}>Open</button></div>}
        {!noFormula.length && !noMsds.length && !review.length && !due.length && <Empty>Nothing waiting. 👍</Empty>}
      </div>
    </>
  );
}

// ── ingredients ──────────────────────────────────────────────────────────
function Ingredients({ rows, reload }) {
  const [q, setQ] = useState(""); const [st, setSt] = useState(""); const [edit, setEdit] = useState(null); const [shown, setShown] = useState(60);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (!st || r.status === st) && (!s || [r.name, r.inci_name, r.cas, r.supplier, r.function].join(" ").toLowerCase().includes(s))).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, q, st]);
  return (
    <>
      <div className="qc-filters" style={{ marginBottom: 8 }}>
        <div className="rg-search" style={{ flex: 1, minWidth: 220 }}><SearchBox value={q} onChange={(v) => { setQ(v); setShown(60); }} placeholder="🔎 Search name, INCI, CAS, supplier…" /></div>
        <select className="inp inp-filter" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All</option><option value="review">To verify</option><option value="verified">Verified</option></select>
        <button className="btn-primary sm" onClick={() => setEdit({})}>＋ New ingredient</button>
      </div>
      {list.length === 0 ? <Empty>No ingredients match.</Empty> : (
        <div className="table-wrap"><table className="tbl qc-tbl">
          <thead><tr><th>Name</th><th>INCI</th><th>CAS</th><th>Supplier</th><th>Hazard</th><th></th></tr></thead>
          <tbody>{list.slice(0, shown).map((r) => (
            <tr key={r.id} className="qc-tr" onClick={() => setEdit(r)}>
              <td><b>{r.name}</b>{r.function && <small className="qc-sub"> {r.function}</small>}</td><td>{r.inci_name || "—"}</td><td className="nowrap">{r.cas || "—"}</td><td>{r.supplier || "—"}</td>
              <td>{(r.hazard?.h || []).length ? <span className="qc-tent late">{r.hazard.h.join(" ")}</span> : <span className="small-muted">none listed</span>}</td>
              <td>{r.status === "verified" ? <span className="qc-pill" style={{ background: "#16a34a" }}>Verified</span> : <span className="qc-pill" style={{ background: "#d97706" }}>To verify</span>}</td>
            </tr>))}</tbody></table></div>)}
      {list.length > shown && <div style={{ textAlign: "center", marginTop: 10 }}><button className="btn-ghost" onClick={() => setShown((n) => n + 100)}>Show more ({list.length - shown} left)</button></div>}
      {edit && <IngredientForm row={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

const PHYS = [["appearance", "Appearance"], ["colour", "Colour"], ["odour", "Odour"], ["ph", "pH"], ["density", "Density"], ["solubility", "Solubility in water"], ["viscosity", "Viscosity"], ["boiling", "Boiling point"], ["flash", "Flash point"]];
const SAFE = [["skin", "First aid: skin"], ["eyes", "First aid: eyes"], ["inhalation", "First aid: inhalation"], ["ingestion", "First aid: ingestion"], ["fire", "Fire-fighting"], ["spill", "Accidental release"], ["handling", "Handling"], ["storage", "Storage"], ["incompatible", "Incompatible materials"], ["ppe", "Protection (PPE)"], ["tox", "Toxicology"], ["eco", "Ecology"], ["disposal", "Disposal"], ["transport", "Transport"]];

function IngredientForm({ row, onClose, onSaved }) {
  const { isOwner } = useData();
  const [ask, dialog] = useConfirm();
  const [f, setF] = useState(() => ({
    name: row?.name || "", inci_name: row?.inci_name || "", cas: row?.cas || "", einecs: row?.einecs || "", function: row?.function || "", supplier: row?.supplier || "", origin: row?.origin || "",
    signal: row?.hazard?.signal || "", classification: row?.hazard?.classification || "", h: (row?.hazard?.h || []).join(", "), p: (row?.hazard?.p || []).join(", "),
    limits: row?.limits || "", source_url: row?.source_url || "", source_name: row?.source_name || "", source_date: row?.source_date || "", notes: row?.notes || "", verified: row?.status === "verified",
    physchem: { ...(row?.physchem || {}) }, safety: { ...(row?.safety || {}) },
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setIn = (g, k) => (e) => setF((x) => ({ ...x, [g]: { ...x[g], [k]: e.target.value } }));
  const save = async () => {
    if (!f.name.trim()) { toast("Write the name of the material.", "err"); return; }
    setBusy(true);
    const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => String(v || "").trim()).map(([k, v]) => [k, String(v).trim()]));
    const rec = { name: f.name.trim(), inci_name: f.inci_name.trim() || null, cas: f.cas.trim() || null, einecs: f.einecs.trim() || null, function: f.function.trim() || null, supplier: f.supplier.trim() || null, origin: f.origin.trim() || null,
      hazard: { signal: f.signal || undefined, classification: f.classification.trim() || undefined, h: lst(f.h), p: lst(f.p) }, physchem: compact(f.physchem), safety: compact(f.safety),
      limits: f.limits.trim() || null, source_url: f.source_url.trim() || null, source_name: f.source_name.trim() || null, source_date: f.source_date || null, notes: f.notes.trim() || null, status: f.verified ? "verified" : "review" };
    const r = row ? await run(supabase.from("reg_ingredients").update(rec).eq("id", row.id), "Saved") : await run(supabase.from("reg_ingredients").insert(rec), "Ingredient added");
    setBusy(false); if (r.ok) onSaved();
  };
  const remove = async () => {
    if (!(await ask({ title: "Delete this ingredient?", body: `${row.name} will be removed from the library. Formulas that use it keep the name.`, okText: "Delete", danger: true }))) return;
    const r = await run(supabase.from("reg_ingredients").update({ deleted_at: new Date().toISOString() }).eq("id", row.id), "Deleted"); if (r.ok) onSaved();
  };
  const T = (k, label, ph) => <Field label={label}><input className="form-inp" value={f[k]} onChange={set(k)} placeholder={ph} /></Field>;
  return (
    <Modal title={row ? row.name : "New ingredient"} onClose={onClose} wide
      actions={<>{row && isOwner && <button className="btn-danger" style={{ marginRight: "auto" }} onClick={remove}>Delete</button>}<button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="qc-sec">Identity</div>
      <div className="form-grid">{T("name", "Name (as bought)")}{T("inci_name", "INCI name")}{T("cas", "CAS no.")}{T("einecs", "EINECS no.")}{T("function", "Function", "e.g. Humectant")}{T("supplier", "Supplier")}{T("origin", "Origin", "Synthetic / Vegetable")}</div>
      <div className="qc-sec">Hazards (from the supplier MSDS)</div>
      <div className="form-grid">
        <Field label="Signal word"><select className="form-inp" value={f.signal} onChange={set("signal")}><option value="">None</option><option>Warning</option><option>Danger</option></select></Field>
        {T("h", "Hazard statements (H codes)", "H315, H319")}{T("p", "Precaution statements (P codes)", "P302+P352")}
      </div>
      <Field label="Classification as written by the supplier"><textarea className="form-inp" rows={2} value={f.classification} onChange={set("classification")} /></Field>
      <Field label="Limits or restrictions" hint="For example the highest allowed use level or a ban in some markets."><input className="form-inp" value={f.limits} onChange={set("limits")} /></Field>
      <div className="qc-sec">Physical and chemical properties</div>
      <div className="form-grid">{PHYS.map(([k, l]) => <Field key={k} label={l}><input className="form-inp" value={val(f.physchem, k)} onChange={setIn("physchem", k)} /></Field>)}</div>
      <div className="qc-sec">Safety information</div>
      {SAFE.map(([k, l]) => <Field key={k} label={l}><textarea className="form-inp" rows={2} value={val(f.safety, k)} onChange={setIn("safety", k)} /></Field>)}
      <div className="qc-sec">Source</div>
      <div className="form-grid">{T("source_name", "Document name")}{T("source_url", "Link to the file")}<Field label="Date of the document"><input className="form-inp" type="date" value={f.source_date} onChange={set("source_date")} /></Field></div>
      <Field label="Notes"><textarea className="form-inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      <label className="chk"><input type="checkbox" checked={f.verified} onChange={(e) => setF((x) => ({ ...x, verified: e.target.checked }))} /> Verified: I have compared this with the supplier's document</label>
      {dialog}
    </Modal>
  );
}

// ── products and formulas ────────────────────────────────────────────────
function Products({ rows, ings, reload }) {
  const [q, setQ] = useState(""); const [firm, setFirm] = useState(""); const [edit, setEdit] = useState(null); const [pick, setPick] = useState(new Set()); const [bulk, setBulk] = useState(false);
  const [open, setOpen] = useState({});
  const owners = useMemo(() => [...new Set(rows.map((r) => r.brand_owner).filter(Boolean))].sort(), [rows]);
  const list = useMemo(() => { const s = q.trim().toLowerCase(); return rows.filter((r) => (!firm || r.firm_id === firm) && (!s || [r.name, r.category, r.licence_ref, r.brand_owner].join(" ").toLowerCase().includes(s))).sort((a, b) => a.name.localeCompare(b.name)); }, [rows, q, firm]);
  const own = list.filter((r) => !r.brand_owner);
  const byOwner = useMemo(() => { const m = {}; list.filter((r) => r.brand_owner).forEach((r) => { (m[r.brand_owner] ||= []).push(r); }); return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0])); }, [list]);
  const toggle = (id) => setPick((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const Row = ({ r }) => (
    <tr className="qc-tr" onClick={() => setEdit(r)}>
      <td onClick={(e) => e.stopPropagation()} style={{ width: 28 }}><input type="checkbox" checked={pick.has(r.id)} onChange={() => toggle(r.id)} /></td>
      <td><span className="tk-firm" style={{ background: FIRM_COLORS[r.firm_id] }}>{r.firm_id}</span><b>{r.name}</b></td><td>{r.category || "—"}</td><td>{r.licence_ref || "—"}</td>
      <td>{r.approval_file ? <a href="#open" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openRegFile(r.approval_file); }}>Approval ↗</a> : r.approval_url ? <a href={r.approval_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open ↗</a> : "—"}</td></tr>);
  const Table = ({ items }) => <div className="table-wrap"><table className="tbl qc-tbl"><thead><tr><th></th><th>Product</th><th>Category</th><th>Licence</th><th>Approval</th></tr></thead><tbody>{items.map((r) => <Row key={r.id} r={r} />)}</tbody></table></div>;
  return (
    <>
      <div className="qc-filters" style={{ marginBottom: 8 }}>
        <div className="rg-search" style={{ flex: 1, minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="🔎 Search product, category, licence, brand owner…" /></div>
        <select className="inp inp-filter" value={firm} onChange={(e) => setFirm(e.target.value)}><option value="">All firms</option>{FIRMS.map((x) => <option key={x}>{x}</option>)}</select>
        {pick.size > 0 && <button className="btn-ghost sm" onClick={() => setBulk(true)}>Set brand owner for {pick.size} selected</button>}
        <button className="btn-primary sm" onClick={() => setEdit({})}>＋ New product</button>
      </div>
      {list.length === 0 ? <Empty>No products yet. Add one, then paste its ingredient list from the FDA approval.</Empty> : (
        <>
          <div className="rg-group"><h3>Velite's own brands <span className="section-count">{own.length}</span></h3>{own.length ? <Table items={own} /> : <div className="small-muted">None.</div>}</div>
          {byOwner.length > 0 && <div className="rg-group"><h3>Other companies' brands <span className="section-count">{byOwner.reduce((a, [, v]) => a + v.length, 0)}</span></h3>
            <div className="small-muted" style={{ marginBottom: 6 }}>Products Velite manufactures for other companies, grouped by the company.</div>
            {byOwner.map(([name, items]) => (
              <div key={name} className="rg-sub">
                <button className="rg-sub-head" onClick={() => setOpen((x) => ({ ...x, [name]: !x[name] }))}>{open[name] === false ? "▸" : "▾"} {name} <span className="section-count">{items.length}</span></button>
                {open[name] !== false && <Table items={items} />}
              </div>))}
          </div>}
        </>)}
      {edit && <ProductForm row={edit.id ? edit : null} ings={ings} owners={owners} onClose={() => setEdit(null)} onSaved={() => { reload(); }} />}
      {bulk && <BulkOwner ids={[...pick]} owners={owners} onClose={() => setBulk(false)} onDone={() => { setBulk(false); setPick(new Set()); reload(); }} />}
    </>
  );
}

function BulkOwner({ ids, owners, onClose, onDone }) {
  const [v, setV] = useState(""); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); const r = await run(supabase.from("reg_products").update({ brand_owner: v.trim() || null }).in("id", ids), v.trim() ? `Brand owner set for ${ids.length} products` : `${ids.length} products set as Velite's own brands`); setBusy(false); if (r.ok) onDone(); };
  return (
    <Modal title={`Brand owner for ${ids.length} products`} onClose={onClose} actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={go} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <Field label="Company that owns the brand" hint="Leave empty to make them Velite's own brands."><input className="form-inp" list="rg-owners" value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. Dreamax Healthcare" /></Field>
      <datalist id="rg-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
    </Modal>
  );
}

function ProductForm({ row, ings, owners = [], onClose, onSaved }) {
  const { isOwner } = useData();
  const [ask, dialog] = useConfirm();
  const [id, setId] = useState(row?.id || null);
  const [f, setF] = useState(() => ({ firm_id: row?.firm_id || "VH", name: row?.name || "", brand_owner: row?.brand_owner || "", category: row?.category || "", form: row?.form || "", licence_ref: row?.licence_ref || "", approval_url: row?.approval_url || "", approval_date: row?.approval_date || "",
    storage: row?.storage || "", shelf_life: row?.shelf_life || "", notes: row?.notes || "", physchem: { ...(row?.physchem || {}) } }));
  const [lines, setLines] = useState([]); const [loaded, setLoaded] = useState(!row); const [busy, setBusy] = useState(false); const [paste, setPaste] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setPh = (k) => (e) => setF((x) => ({ ...x, physchem: { ...x.physchem, [k]: e.target.value } }));
  useEffect(() => { if (!row) return; supabase.from("reg_formula_lines").select("*").eq("product_id", row.id).order("position").then(({ data }) => { setLines(data || []); setLoaded(true); }); }, []); // eslint-disable-line
  const match = (label) => { const s = label.toLowerCase().trim(); return ings.find((i) => (i.inci_name || "").toLowerCase() === s || i.name.toLowerCase() === s) || null; };

  const saveProduct = async () => {
    if (!f.name.trim()) { toast("Write the product name.", "err"); return null; }
    const rec = { firm_id: f.firm_id, name: f.name.trim(), brand_owner: f.brand_owner.trim() || null, category: f.category.trim() || null, form: f.form.trim() || null, licence_ref: f.licence_ref.trim() || null, approval_url: f.approval_url.trim() || null, approval_date: f.approval_date || null,
      storage: f.storage.trim() || null, shelf_life: f.shelf_life.trim() || null, notes: f.notes.trim() || null, physchem: Object.fromEntries(Object.entries(f.physchem).filter(([, v]) => String(v || "").trim())) };
    if (id) { const r = await run(supabase.from("reg_products").update(rec).eq("id", id)); return r.ok ? id : null; }
    const r = await run(supabase.from("reg_products").insert(rec).select("id").single());
    if (r.ok) { setId(r.data.id); return r.data.id; } return null;
  };
  const save = async (close) => {
    setBusy(true);
    const pid = await saveProduct();
    if (pid && loaded) {
      const del = await supabase.from("reg_formula_lines").delete().eq("product_id", pid);
      if (del.error) { toast(del.error.message, "err"); setBusy(false); return; }
      const rows = lines.filter((l) => l.label.trim()).map((l, i) => ({ product_id: pid, position: i + 1, ingredient_id: l.ingredient_id || null, label: l.label.trim(), inci_name: l.inci_name || null, cas: l.cas || null,
        pct: l.pct === "" || l.pct == null ? null : Number(l.pct), pct_text: l.pct_text || null, function: l.function || null }));
      if (rows.length) { const ins = await supabase.from("reg_formula_lines").insert(rows); if (ins.error) { toast(ins.error.message, "err"); setBusy(false); return; } }
    }
    setBusy(false); toast("Saved"); onSaved(); if (close) onClose();
  };
  const addPasted = () => {
    const names = splitIngredientList(paste); if (!names.length) return;
    setLines((x) => [...x, ...names.map((n) => { const m = match(n); return { label: n, ingredient_id: m?.id || null, inci_name: m?.inci_name || null, cas: m?.cas || null, function: m?.function || null, pct: null, pct_text: null }; })]);
    setPaste("");
  };
  const upd = (i, patch) => setLines((x) => x.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const mv = (i, d) => setLines((x) => { const a = x.slice(); const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const pickIng = (i, label) => { const m = match(label); upd(i, { label, ingredient_id: m?.id || null, inci_name: m?.inci_name || null, cas: m?.cas || null, function: m?.function || null }); };
  const remove = async () => {
    if (!(await ask({ title: "Delete this product?", body: `${row.name} and its formula move out of the list. MSDS already made stay.`, okText: "Delete", danger: true }))) return;
    const r = await run(supabase.from("reg_products").update({ deleted_at: new Date().toISOString() }).eq("id", row.id), "Deleted"); if (r.ok) { onSaved(); onClose(); }
  };
  const total = lines.reduce((a, l) => a + (l.pct != null && l.pct !== "" ? Number(l.pct) : 0), 0);

  return (
    <Modal title={row ? row.name : "New product"} onClose={onClose} wide
      actions={<>{row && isOwner && <button className="btn-danger" style={{ marginRight: "auto" }} onClick={remove}>Delete</button>}<button className="btn-ghost" onClick={onClose}>Close</button><button className="btn-primary" onClick={() => save(false)} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="form-grid">
        <Field label="Firm"><select className="form-inp" value={f.firm_id} onChange={set("firm_id")}>{FIRMS.map((x) => <option key={x} value={x}>{x} · {FIRM_NAMES[x]}</option>)}</select></Field>
        <Field label="Product name"><input className="form-inp" value={f.name} onChange={set("name")} /></Field>
        <Field label="Brand owner" hint="Leave empty for Velite's own brands. For a product made for another company, write that company."><input className="form-inp" list="rg-owners2" value={f.brand_owner} onChange={set("brand_owner")} placeholder="e.g. Dreamax Healthcare" /></Field>
        <datalist id="rg-owners2">{owners.map((o) => <option key={o} value={o} />)}</datalist>
        <Field label="Category"><input className="form-inp" value={f.category} onChange={set("category")} placeholder="Face wash, serum, cream…" /></Field>
        <Field label="Form"><input className="form-inp" value={f.form} onChange={set("form")} placeholder="Liquid, gel, cream…" /></Field>
        <Field label="Manufacturing licence no."><input className="form-inp" value={f.licence_ref} onChange={set("licence_ref")} /></Field>
        <Field label="FDA approval date"><input className="form-inp" type="date" value={f.approval_date} onChange={set("approval_date")} /></Field>
      </div>
      <Field label="Link to the FDA approval or approved list"><input className="form-inp" value={f.approval_url} onChange={set("approval_url")} /></Field>
      <div className="qc-sec">Properties used in the MSDS</div>
      <div className="form-grid">{PHYS.map(([k, l]) => <Field key={k} label={l}><input className="form-inp" value={val(f.physchem, k)} onChange={setPh(k)} /></Field>)}
        <Field label="Storage"><input className="form-inp" value={f.storage} onChange={set("storage")} placeholder="Below 25 °C, away from sunlight" /></Field><Field label="Shelf life"><input className="form-inp" value={f.shelf_life} onChange={set("shelf_life")} /></Field></div>

      <div className="qc-sec">Formula ({lines.length} ingredients{lines.some((l) => l.pct != null && l.pct !== "") ? `, ${total.toFixed(2)}%` : ""})</div>
      {!id && <div className="small-muted">Save the product first, then add its formula.</div>}
      {id && !loaded && <div className="loading">Loading formula…</div>}
      {id && loaded && <>
        <datalist id="rg-ings">{ings.map((i) => <option key={i.id} value={i.inci_name || i.name} />)}</datalist>
        <div className="small-muted" style={{ marginBottom: 6 }}>Ingredients in the order of the approval (largest first). Percentages are optional. A name that matches the ingredient library is linked, so its supplier data is used.</div>
        {lines.map((l, i) => (
          <div key={i} className="rg-line">
            <span className="small-muted">{i + 1}</span>
            <input className="form-inp" list="rg-ings" value={l.label} onChange={(e) => pickIng(i, e.target.value)} placeholder="Ingredient (INCI)" />
            <input className="form-inp" type="number" step="any" placeholder="%" value={l.pct ?? ""} onChange={(e) => upd(i, { pct: e.target.value })} />
            <input className="form-inp" placeholder="or q.s. / <1" value={l.pct_text || ""} onChange={(e) => upd(i, { pct_text: e.target.value })} />
            <span className={l.ingredient_id ? "rg-linked" : "rg-unlinked"} title={l.ingredient_id ? "Linked to the ingredient library" : "Not in the ingredient library"}>{l.ingredient_id ? "●" : "○"}</span>
            <button className="icon-btn" onClick={() => mv(i, -1)}>↑</button><button className="icon-btn" onClick={() => mv(i, 1)}>↓</button><button className="icon-btn" onClick={() => setLines((x) => x.filter((_, j) => j !== i))}>✕</button>
          </div>))}
        <div className="bd-split">
          <b>Paste an ingredient list</b>
          <textarea className="form-inp" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Water, Propylene Glycol, Polysorbate 20, …" />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}><button className="btn-ghost sm" onClick={addPasted}>Add these ingredients</button>
            <button className="btn-ghost sm" onClick={() => setLines((x) => [...x, { label: "", pct: null }])}>＋ Add one</button></div>
        </div>
      </>}
      <Field label="Notes"><textarea className="form-inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      {dialog}
    </Modal>
  );
}

// ── MSDS list and maker ──────────────────────────────────────────────────
function MsdsList({ prods, ings }) {
  const { me } = useData();
  const [sheets, setSheets] = useState(null); const [open, setOpen] = useState(null); const [picking, setPicking] = useState(false); const [wizard, setWizard] = useState(false); const [pid, setPid] = useState(""); const [q, setQ] = useState("");
  const [tpl] = useSetting(TEMPLATE_KEY); const [firms] = useSetting("firms");
  const load = async () => { const { data } = await supabase.from("reg_msds").select("*").order("updated_at", { ascending: false }); setSheets(data || []); };
  useEffect(() => { load(); }, []);
  const pmap = useMemo(() => Object.fromEntries(prods.map((p) => [p.id, p])), [prods]);
  const create = async () => {
    const p = pmap[pid]; if (!p) return;
    const { data: lines } = await supabase.from("reg_formula_lines").select("*").eq("product_id", p.id).order("position");
    const mine = (sheets || []).filter((s) => s.product_id === p.id); const version = (mine.reduce((a, s) => Math.max(a, s.version), 0)) + 1;
    const seq = (sheets || []).filter((s) => pmap[s.product_id]?.firm_id === p.firm_id).length + 1;
    const docNo = `${p.firm_id}/MSDS/${String(seq).padStart(3, "0")}`;
    const content = buildMsds({ product: p, lines: lines || [], ingredients: ings, firm: firms?.[p.firm_id], template: tpl, preparedBy: me.full_name, docNo, version });
    const r = await run(supabase.from("reg_msds").insert({ product_id: p.id, version, doc_no: docNo, content, prepared_by_name: me.full_name, prepared_on: todayISO(), review_due: content.meta.review_due }).select("*").single(), "MSDS started");
    if (r.ok) { setPicking(false); setPid(""); await load(); setOpen(r.data); }
  };
  const list = (sheets || []).filter((s) => !q.trim() || (pmap[s.product_id]?.name || "").toLowerCase().includes(q.trim().toLowerCase()));
  if (!sheets) return <div className="loading">Loading…</div>;
  return (
    <>
      <div className="qc-filters" style={{ marginBottom: 8 }}>
        <div className="rg-search" style={{ flex: 1, minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="🔎 Search by product…" /></div>
        <button className="btn-ghost sm" onClick={() => setWizard(true)}>📎 From an approval sheet</button>
        <button className="btn-primary sm" onClick={() => setPicking(true)}>＋ New MSDS</button>
      </div>
      {list.length === 0 ? <Empty>No MSDS yet. Press “New MSDS” and choose a product with a formula.</Empty> : (
        <div className="table-wrap"><table className="tbl qc-tbl"><thead><tr><th>Product</th><th>Doc no.</th><th>Version</th><th>Prepared</th><th>Approved</th><th>Review due</th><th></th></tr></thead>
          <tbody>{list.map((s) => { const p = pmap[s.product_id]; return (
            <tr key={s.id} className="qc-tr" onClick={() => setOpen(s)}>
              <td>{p && <span className="tk-firm" style={{ background: FIRM_COLORS[p.firm_id] }}>{p.firm_id}</span>}<b>{p?.name || "(deleted product)"}</b></td><td>{s.doc_no || "—"}</td><td>v{s.version}</td>
              <td>{s.prepared_by_name} <small className="qc-sub">{fmtD(s.prepared_on)}</small></td><td>{s.status === "approved" ? `${s.approved_by_name}, ${fmtD(s.approved_on)}` : "—"}</td><td>{fmtD(s.review_due) || "—"}</td>
              <td>{s.status === "approved" ? <span className="qc-pill" style={{ background: "#16a34a" }}>Approved</span> : <span className="qc-pill" style={{ background: "#d97706" }}>Draft</span>}</td></tr>); })}</tbody></table></div>)}
      {picking && (
        <Modal title="New MSDS" onClose={() => setPicking(false)} actions={<><button className="btn-ghost" onClick={() => setPicking(false)}>Cancel</button><button className="btn-primary" onClick={create} disabled={!pid}>Start</button></>}>
          <Field label="Product" hint="The sheet is built from the product's formula and the ingredient library. You can edit every line afterwards."><select className="form-inp" value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choose…</option>{prods.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>{p.firm_id} · {p.name}</option>)}</select></Field>
        </Modal>)}
      {wizard && <ApprovalWizard prods={prods} ings={ings} sheets={sheets} tpl={tpl} firms={firms} onClose={() => setWizard(false)} onDone={async (first) => { setWizard(false); await load(); if (first) setOpen(first); }} />}
      {open && <MsdsEditor sheet={open} product={pmap[open.product_id]} ings={ings} tpl={tpl} firms={firms} onClose={() => { setOpen(null); load(); }} onChanged={load} />}
    </>
  );
}

// FDA approval sheet in, products + formulas + MSDS drafts out. The file is kept as the source document.
function ApprovalWizard({ prods, ings, sheets, tpl, firms, onClose, onDone }) {
  const { me, regProducts } = useData();
  const [step, setStep] = useState(1); const [firm, setFirm] = useState("VH"); const [path, setPath] = useState(""); const [view, setView] = useState(""); const [isImg, setIsImg] = useState(false);
  const [text, setText] = useState(""); const [fname, setFname] = useState(""); const [busy, setBusy] = useState(false); const [note, setNote] = useState("");
  const [blocks, setBlocks] = useState([]); const [makeMsds, setMakeMsds] = useState(true);
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = (label) => { const k = norm(label); return ings.find((i) => norm(i.inci_name) === k || norm(i.name) === k) || null; };

  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    if (f.size > 15 * 1024 * 1024) { toast("The file is larger than 15 MB.", "err"); return; }
    setBusy(true); setNote(""); setFname(f.name.replace(/\.[^.]+$/, ""));
    const safe = f.name.replace(/[^\w.-]+/g, "_"); const p = `approvals/${Date.now()}_${safe}`;
    const up = await supabase.storage.from("regulatory").upload(p, f, { upsert: false });
    if (up.error) { toast(up.error.message, "err"); setBusy(false); return; }
    setPath(p); setIsImg(/^image\//.test(f.type));
    const sg = await supabase.storage.from("regulatory").createSignedUrl(p, 3600); setView(sg.data?.signedUrl || "");
    if (f.type === "application/pdf") {
      try {
        const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise; let all = "";
        for (let i = 1; i <= Math.min(doc.numPages, 12); i++) { const pg = await doc.getPage(i); const c = await pg.getTextContent(); let line = ""; all += c.items.map((it) => { const s = it.str + (it.hasEOL ? "\n" : " "); return s; }).join("") + "\n"; }
        if (all.replace(/\s/g, "").length > 80) { setText(all); setNote("The text of the PDF was read. Check it against the document, correct it if needed, then press “Read the list”."); }
        else setNote("This PDF is a scan (a picture), so its text cannot be read automatically. Type or paste the ingredient list below, copying it from the document on the right.");
      } catch { setNote("The PDF text could not be read. Type or paste the ingredient list below."); }
    } else setNote("This file is a picture. Type or paste the ingredient list below, copying it from the document on the right.");
    setBusy(false);
  };
  const read = () => {
    const b = parseApprovalText(text, fname).map((x) => ({ include: true, name: x.name || fname, list: x.items.map((i) => (i.pct != null ? `${i.name} ${i.pct}%` : i.name)).join("\n") }));
    if (!b.length) { toast("No product with an ingredient list was found. Check the text: a product name on its own line, then its ingredients separated by commas.", "err"); return; }
    setBlocks(b); setStep(2);
  };
  const upd = (i, patch) => setBlocks((x) => x.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const create = async () => {
    const chosen = blocks.filter((b) => b.include && b.name.trim()); if (!chosen.length) { toast("Tick at least one product.", "err"); return; }
    setBusy(true); let first = null; let made = 0; let sheetsMade = 0;
    try {
      for (const b of chosen) {
        const items = String(b.list).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*%$/); return m ? { name: m[1], pct: Number(m[2]) } : { name: l, pct: null }; });
        let prod = prods.find((p) => p.firm_id === firm && p.name.toLowerCase() === b.name.trim().toLowerCase()); let pid = prod?.id;
        if (!pid) { const r = await supabase.from("reg_products").insert({ firm_id: firm, name: b.name.trim(), approval_file: path || null }).select("*").single(); if (r.error) throw r.error; pid = r.data.id; prod = r.data; made++; }
        else if (!prod.approval_file && path) await supabase.from("reg_products").update({ approval_file: path }).eq("id", pid);
        const { data: have } = await supabase.from("reg_formula_lines").select("id").eq("product_id", pid).limit(1);
        if (!have?.length) {
          const rows = items.map((it, i) => { const m = match(it.name); return { product_id: pid, position: i + 1, ingredient_id: m?.id || null, label: it.name, inci_name: m?.inci_name || null, cas: m?.cas || null, pct: it.pct }; });
          const r = await supabase.from("reg_formula_lines").insert(rows); if (r.error) throw r.error;
        }
        if (makeMsds) {
          const { data: lines } = await supabase.from("reg_formula_lines").select("*").eq("product_id", pid).order("position");
          const mine = (sheets || []).filter((s) => s.product_id === pid); const version = mine.reduce((a, s) => Math.max(a, s.version), 0) + 1;
          const seq = (sheets || []).filter((s) => prods.find((p) => p.id === s.product_id)?.firm_id === firm).length + sheetsMade + 1; const docNo = `${firm}/MSDS/${String(seq).padStart(3, "0")}`;
          const prodFull = { ...(prod || {}), firm_id: firm, name: b.name.trim(), physchem: prod?.physchem || {} };
          const content = buildMsds({ product: prodFull, lines: lines || [], ingredients: ings, firm: firms?.[firm], template: tpl, preparedBy: me.full_name, docNo, version });
          const r = await supabase.from("reg_msds").insert({ product_id: pid, version, doc_no: docNo, content, prepared_by_name: me.full_name, prepared_on: todayISO(), review_due: content.meta.review_due }).select("*").single();
          if (r.error) throw r.error; sheetsMade++; if (!first) first = r.data;
        }
      }
      toast(`${made} product${made === 1 ? "" : "s"} added${makeMsds ? `, ${sheetsMade} MSDS draft${sheetsMade === 1 ? "" : "s"} started` : ""}`);
      regProducts.reload(); onDone(first);
    } catch (x) { toast(x.message || "Something went wrong.", "err"); }
    setBusy(false);
  };

  return (
    <Modal title={step === 1 ? "MSDS from an approval sheet" : "Check the products found"} onClose={onClose} wide
      actions={step === 1 ? <><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={read} disabled={busy || !text.trim()}>Read the list</button></>
        : <><button className="btn-ghost" onClick={() => setStep(1)}>Back</button><button className="btn-primary" onClick={create} disabled={busy}>{busy ? "Creating…" : makeMsds ? "Create products and MSDS drafts" : "Create products"}</button></>}>
      {step === 1 && <>
        <div className="small-muted" style={{ marginBottom: 8 }}>Upload the FDA approval sheet (PDF or picture). The file is kept with the product. Each product on it gets its formula, and an MSDS draft is started for it.</div>
        <div className="form-grid">
          <Field label="Firm"><select className="form-inp" value={firm} onChange={(e) => setFirm(e.target.value)}>{FIRMS.map((x) => <option key={x} value={x}>{x} · {FIRM_NAMES[x]}</option>)}</select></Field>
          <Field label="Approval sheet (PDF or picture)"><input type="file" accept="application/pdf,image/*" onChange={onFile} disabled={busy} /></Field>
        </div>
        {busy && <div className="loading">Reading the file…</div>}
        {note && <div className="bd-split">{note}</div>}
        <div className="rg-wiz">
          {view && <div className="rg-wiz-view">{isImg ? <img src={view} alt="Approval sheet" /> : <iframe title="Approval sheet" src={view} />}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Field label="Text of the approval" hint="A product name on its own line (for example “1. Face Toner”), then its ingredients separated by commas. Several products on one sheet are fine. An ingredient can end with its percentage, for example “Niacinamide 5%”.">
              <textarea className="form-inp" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={"1. Face Toner\nWater, Propylene Glycol, Polysorbate 20, …\n\n2. Exfoliating Face Wash\nAqua, Sodium Laureth Sulfate, …"} />
            </Field>
          </div>
        </div>
      </>}
      {step === 2 && <>
        <label className="chk" style={{ marginBottom: 8 }}><input type="checkbox" checked={makeMsds} onChange={(e) => setMakeMsds(e.target.checked)} /> Also start an MSDS draft for each product</label>
        {blocks.map((b, i) => (
          <div key={i} className="bd-split">
            <label className="chk"><input type="checkbox" checked={b.include} onChange={(e) => upd(i, { include: e.target.checked })} /> <b>Product {i + 1}</b></label>
            <Field label="Product name"><input className="form-inp" value={b.name} onChange={(e) => upd(i, { name: e.target.value })} /></Field>
            <Field label={`Ingredients (${String(b.list).split("\n").filter((l) => l.trim()).length}), one per line, in the order of the approval`}><textarea className="form-inp" rows={7} value={b.list} onChange={(e) => upd(i, { list: e.target.value })} /></Field>
          </div>))}
        <div className="small-muted">A product that already exists keeps its formula; only its MSDS draft is added.</div>
      </>}
    </Modal>
  );
}

function MsdsEditor({ sheet, product, ings, tpl, firms, onClose, onChanged }) {
  const { isOwner, me } = useData();
  const [ask, dialog] = useConfirm();
  const [s, setS] = useState(sheet); const [c, setC] = useState(sheet.content); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState([]); const [print, setPrint] = useState(false);
  const approved = s.status === "approved";
  useEffect(() => { if (product) supabase.from("reg_formula_lines").select("*").eq("product_id", product.id).order("position").then(({ data }) => setLines(data || [])); }, [product?.id]); // eslint-disable-line
  const notes = useMemo(() => (product ? reviewNotes({ product, lines, ingredients: ings }) : []), [product, lines, ings]);
  const edit = (fn) => { setC((x) => { const n = JSON.parse(JSON.stringify(x)); fn(n); return n; }); setDirty(true); };
  const save = async () => {
    setBusy(true);
    const r = await run(supabase.from("reg_msds").update({ content: c, doc_no: c.meta.doc_no || null, prepared_by_name: c.meta.prepared_by || null, prepared_on: c.meta.prepared_on || null, review_due: c.meta.review_due || null }).eq("id", s.id).select("*").single(), "Saved");
    setBusy(false); if (r.ok) { setS(r.data); setDirty(false); onChanged(); }
  };
  const rebuild = async () => {
    if (!(await ask({ title: "Rebuild from the formula?", body: "This replaces every section with the standard wording and the current formula. Your edits to this draft are lost.", okText: "Rebuild", danger: true }))) return;
    const n = buildMsds({ product, lines, ingredients: ings, firm: firms?.[product.firm_id], template: tpl, preparedBy: c.meta.prepared_by, docNo: c.meta.doc_no, version: s.version });
    setC(n); setDirty(true);
  };
  const approve = async () => {
    if (dirty) { toast("Save the changes first.", "err"); return; }
    if (!(await ask({ title: "Approve this MSDS?", body: "Once approved it can no longer be edited. To change it later you make a new version.", okText: "Approve" }))) return;
    const r = await run(supabase.from("reg_msds").update({ status: "approved" }).eq("id", s.id).select("*").single(), "MSDS approved");
    if (r.ok) { setS(r.data); onChanged(); }
  };
  const newVersion = async () => {
    const n = JSON.parse(JSON.stringify(c)); n.meta.version = s.version + 1; n.meta.prepared_on = todayISO(); n.meta.prepared_by = me.full_name;
    const r = await run(supabase.from("reg_msds").insert({ product_id: s.product_id, version: s.version + 1, doc_no: s.doc_no, content: n, prepared_by_name: me.full_name, prepared_on: todayISO(), review_due: n.meta.review_due }).select("*").single(), "New version started");
    if (r.ok) { onChanged(); onClose(); }
  };
  const remove = async () => {
    if (!(await ask({ title: "Delete this draft?", body: "A draft can be deleted. Approved sheets are kept.", okText: "Delete", danger: true }))) return;
    const r = await run(supabase.from("reg_msds").delete().eq("id", s.id), "Deleted"); if (r.ok) { onChanged(); onClose(); }
  };
  const word = async () => {
    const blob = await toDocx(c, { approvedBy: s.approved_by_name, approvedOn: s.approved_on, status: s.status });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `MSDS ${c.header.product} v${s.version}.docx`; a.click(); URL.revokeObjectURL(a.href);
  };
  const doPrint = () => { setPrint(true); document.body.classList.add("rg-printing"); setTimeout(() => { const t = document.title; document.title = `MSDS ${c.header.product} v${s.version}`; window.print(); document.title = t; document.body.classList.remove("rg-printing"); setPrint(false); }, 250); };
  const dis = approved;
  return (
    <Modal title={`${c.header.product} · MSDS v${s.version}${approved ? " · approved" : " · draft"}`} onClose={() => { if (dirty && !window.confirm("You have unsaved changes. Close anyway?")) return; onClose(); }} wide
      actions={<>
        {!approved && <button className="btn-danger" style={{ marginRight: "auto" }} onClick={remove}>Delete draft</button>}
        <button className="btn-ghost" onClick={word}>Word</button><button className="btn-ghost" onClick={doPrint}>Print / PDF</button>
        {approved ? <button className="btn-primary" onClick={newVersion}>Make a new version</button> : <>
          <button className="btn-ghost" onClick={rebuild}>Rebuild from formula</button>
          <button className="btn-primary" onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</button>
          {isOwner && <button className="btn-primary" onClick={approve}>Approve</button>}</>}
      </>}>
      {approved && <div className="mt-dup" style={{ background: "#ecfdf5", color: "#166534" }}>✅ Approved by {s.approved_by_name} on {fmtD(s.approved_on)}. It cannot be edited. Use “Make a new version” to change it.</div>}
      {!approved && !isOwner && <div className="small-muted" style={{ marginBottom: 6 }}>Only an owner can approve. Save your draft when it is ready.</div>}
      {notes.length > 0 && !approved && (
        <div className="bd-split" style={{ marginBottom: 10 }}><b>To check before approval</b>
          {notes.slice(0, 14).map((n, i) => <div key={i} className={`rg-note ${n.level}`}>{n.level === "red" ? "⛔" : n.level === "amber" ? "⚠️" : "ℹ️"} {n.text}</div>)}
          {notes.length > 14 && <div className="small-muted">+{notes.length - 14} more</div>}
        </div>)}
      <div className="form-grid">
        <Field label="Document no."><input className="form-inp" disabled={dis} value={c.meta.doc_no || ""} onChange={(e) => edit((n) => { n.meta.doc_no = e.target.value; })} /></Field>
        <Field label="Prepared by"><input className="form-inp" disabled={dis} value={c.meta.prepared_by || ""} onChange={(e) => edit((n) => { n.meta.prepared_by = e.target.value; })} /></Field>
        <Field label="Date prepared"><input className="form-inp" type="date" disabled={dis} value={c.meta.prepared_on || ""} onChange={(e) => edit((n) => { n.meta.prepared_on = e.target.value; })} /></Field>
        <Field label="Review due"><input className="form-inp" type="date" disabled={dis} value={c.meta.review_due || ""} onChange={(e) => edit((n) => { n.meta.review_due = e.target.value; })} /></Field>
      </div>
      {c.sections.map((sec, si) => (
        <div key={sec.no} className="rg-sec">
          <div className="qc-sec">Section {sec.no} · {sec.title}</div>
          {sec.rows && (
            <div className="table-wrap"><table className="tbl"><thead><tr><th>Ingredient</th><th>INCI name</th><th>%</th><th>CAS</th><th>Function</th>{!dis && <th></th>}</tr></thead>
              <tbody>{sec.rows.map((r, ri) => <tr key={ri}>{["label", "inci", "pct", "cas", "function"].map((k) => <td key={k}><input className="form-inp" style={{ minWidth: k === "pct" ? 60 : 110 }} disabled={dis} value={r[k] || ""} onChange={(e) => edit((n) => { n.sections[si].rows[ri][k] = e.target.value; })} /></td>)}
                {!dis && <td><button className="icon-btn" onClick={() => edit((n) => { n.sections[si].rows.splice(ri, 1); })}>✕</button></td>}</tr>)}</tbody></table>
              {!dis && <button className="btn-ghost sm" onClick={() => edit((n) => { n.sections[si].rows.push({ label: "", inci: "", pct: "", cas: "", function: "" }); })}>＋ Add a row</button>}</div>)}
          {sec.items.map((it, ii) => <Field key={it.k} label={it.label}><textarea className="form-inp" rows={Math.min(4, Math.max(1, Math.ceil((it.value || "").length / 90)))} disabled={dis} value={it.value} onChange={(e) => edit((n) => { n.sections[si].items[ii].value = e.target.value; })} /></Field>)}
        </div>))}
      {print && createPortal(<MsdsPaper c={c} s={s} />, document.body)}
      {dialog}
    </Modal>
  );
}

// the printed page (shown only while printing)
function MsdsPaper({ c, s }) {
  return (
    <div id="msds-print">
      <div className="mp-head"><b>{c.header.company}</b><div>{c.header.address}</div><h1>{c.header.title}</h1></div>
      <table className="mp-meta"><tbody>
        <tr><th>Product</th><td><b>{c.header.product}</b></td><th>Document no. / version</th><td>{c.meta.doc_no || "-"} / v{c.meta.version}</td></tr>
        <tr><th>Date prepared</th><td>{fmtD(c.meta.prepared_on)}</td><th>Prepared by</th><td>{c.meta.prepared_by}</td></tr>
        <tr><th>Review due</th><td>{fmtD(c.meta.review_due)}</td><th>Approved by</th><td>{s.status === "approved" ? `${s.approved_by_name}, ${fmtD(s.approved_on)}` : "Not yet approved (draft)"}</td></tr></tbody></table>
      {c.sections.map((sec) => (
        <div key={sec.no} className="mp-sec">
          <h2>SECTION {sec.no} - {sec.title.toUpperCase()}</h2>
          {sec.rows && <table className="mp-tbl"><thead><tr><th>Ingredient</th><th>INCI name</th><th>% w/w</th><th>CAS no.</th><th>Function</th></tr></thead><tbody>{sec.rows.map((r, i) => <tr key={i}><td>{r.label}</td><td>{r.inci}</td><td>{r.pct}</td><td>{r.cas}</td><td>{r.function}</td></tr>)}</tbody></table>}
          {sec.items.filter((i) => (i.value || "").trim()).map((i) => <p key={i.k}><b>{i.label}:</b> {i.value}</p>)}
        </div>))}
    </div>
  );
}

// ── settings (owners) ────────────────────────────────────────────────────
function Settings({ reload }) {
  const [firms, reloadF] = useSetting("firms"); const [tpl, reloadT] = useSetting(TEMPLATE_KEY);
  const [fv, setFv] = useState(null); const [tv, setTv] = useState(null); const [ask, dialog] = useConfirm();
  useEffect(() => { if (firms !== undefined) setFv(JSON.parse(JSON.stringify(firms || {}))); }, [firms]);
  useEffect(() => { if (tpl !== undefined) setTv(JSON.parse(JSON.stringify(tpl?.sections ? tpl : DEFAULT_TEMPLATE))); }, [tpl]);
  if (!fv || !tv) return <div className="loading">Loading…</div>;
  const saveFirms = async () => { const r = await run(supabase.from("reg_settings").upsert({ key: "firms", value: fv }), "Company details saved"); if (r.ok) reloadF(); };
  const saveTpl = async () => { const r = await run(supabase.from("reg_settings").upsert({ key: TEMPLATE_KEY, value: tv }), "Standard wording saved. New sheets use it; sheets already made are not changed."); if (r.ok) reloadT(); };
  const reset = async () => { if (await ask({ title: "Go back to the built-in wording?", body: "Your changes to the standard wording are replaced.", okText: "Reset", danger: true })) setTv(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE))); };
  return (
    <>
      <div className="ipanel"><div className="ipanel-head"><div><h3>Company details on the MSDS</h3><p>Printed at the top of each sheet and used in Section 1.</p></div></div>
        {FIRMS.map((k) => (
          <div key={k} className="rg-firm"><b>{k}</b>
            {[["company", "Company name"], ["address", "Address"], ["phone", "Telephone"], ["email", "Email"]].map(([f, l]) => <input key={f} className="form-inp" placeholder={l} value={fv[k]?.[f] || ""} onChange={(e) => setFv((x) => ({ ...x, [k]: { ...(x[k] || {}), [f]: e.target.value } }))} />)}
          </div>))}
        <button className="btn-primary sm" onClick={saveFirms}>Save company details</button></div>
      <div className="ipanel"><div className="ipanel-head"><div><h3>Standard wording of the MSDS</h3><p>The text every new sheet starts with. Fields marked “from the product” are filled from the product when there is data, and use this text when there is none.</p></div></div>
        <Field label="Years until a sheet is due for review"><input className="form-inp" type="number" min="1" max="10" style={{ maxWidth: 100 }} value={tv.validity_years || 3} onChange={(e) => setTv((x) => ({ ...x, validity_years: Number(e.target.value) || 3 }))} /></Field>
        {tv.sections.map((sec, si) => (
          <div key={sec.no} className="rg-sec"><div className="qc-sec">Section {sec.no} · {sec.title}</div>
            {sec.fields.map((fl, fi) => <Field key={fl.k} label={`${fl.label}${fl.auto ? " (from the product)" : ""}`}><textarea className="form-inp" rows={2} value={fl.text || ""} onChange={(e) => setTv((x) => { const n = JSON.parse(JSON.stringify(x)); n.sections[si].fields[fi].text = e.target.value; return n; })} /></Field>)}
          </div>))}
        <div style={{ display: "flex", gap: 8 }}><button className="btn-primary" onClick={saveTpl}>Save standard wording</button><button className="btn-ghost" onClick={reset}>Reset to built-in</button></div></div>
      <ImportPanel reload={reload} />
      {dialog}
    </>
  );
}

// one-time bulk load of products, formulas and supplier ingredient data read from the existing MSDS files
function ImportPanel({ reload }) {
  const [data, setData] = useState(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [err, setErr] = useState("");
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setErr(""); setDone(null);
    try { const j = JSON.parse(await f.text()); if (!Array.isArray(j.products) || !Array.isArray(j.ingredients)) throw new Error("x"); setData(j); } catch { setErr("This is not an import file made for the Regulatory tab."); }
  };
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const run1 = async () => {
    setBusy(true); const res = { ing: 0, ingSkip: 0, prod: 0, prodSkip: 0, lines: 0, linked: 0 };
    try {
      const { data: have } = await supabase.from("reg_ingredients").select("id,name,supplier,inci_name,cas").is("deleted_at", null).limit(10000);
      const key = (n, s) => `${String(n).toLowerCase()}|${String(s || "").toLowerCase()}`;
      const known = new Set((have || []).map((i) => key(i.name, i.supplier)));
      const all = [...data.ingredients, ...(data.stubs || [])].filter((i) => { const k = key(i.name, i.supplier); if (known.has(k)) { res.ingSkip++; return false; } known.add(k); return true; });
      for (let i = 0; i < all.length; i += 100) {
        const chunk = all.slice(i, i + 100).map((x) => ({ name: x.name, inci_name: x.inci_name || null, cas: x.cas || null, supplier: x.supplier || null, hazard: x.hazard || {}, physchem: x.physchem || {}, safety: x.safety || {},
          source_name: x.source_name || null, source_url: x.source_url || null, source_date: x.source_date || null, status: "review", notes: "Read from the document by the Hub import. Check against the original." }));
        const r = await supabase.from("reg_ingredients").insert(chunk); if (r.error) throw r.error; res.ing += chunk.length;
      }
      const { data: ings } = await supabase.from("reg_ingredients").select("id,name,inci_name,cas").is("deleted_at", null).limit(10000);
      const byCas = new Map(), byName = new Map();
      (ings || []).forEach((i) => { const c = String(i.cas || "").split(/[,;&\s]+/)[0]; if (c && !byCas.has(c)) byCas.set(c, i); [i.name, i.inci_name].forEach((n) => { const k = norm(n); if (k && !byName.has(k)) byName.set(k, i); }); });
      const { data: haveP } = await supabase.from("reg_products").select("id,firm_id,name").is("deleted_at", null).limit(10000);
      const pk = new Set((haveP || []).map((p) => `${p.firm_id}|${p.name.toLowerCase()}`));
      for (const p of data.products) {
        const k = `${p.firm_id}|${p.name.toLowerCase()}`; if (pk.has(k)) { res.prodSkip++; continue; } pk.add(k);
        const ins = await supabase.from("reg_products").insert({ firm_id: p.firm_id, name: p.name, physchem: p.physchem || {}, notes: p.notes || null, brand_owner: p.brand_owner || null, approval_url: p.approval_url || null }).select("id").single();
        if (ins.error) throw ins.error; res.prod++;
        const rows = p.lines.map((l, i) => {
          const c = String(l.cas || "").split(/[,;&{}()\s]+/).filter(Boolean)[0];
          const m = (c && byCas.get(c)) || byName.get(norm(l.inci)) || byName.get(norm(l.label)) || null; if (m) res.linked++;
          return { product_id: ins.data.id, position: i + 1, ingredient_id: m?.id || null, label: l.label, inci_name: l.inci || m?.inci_name || null, cas: l.cas && l.cas.length < 60 ? l.cas : null, pct: l.pct, pct_text: l.pct_text || null };
        });
        for (let i = 0; i < rows.length; i += 200) { const r = await supabase.from("reg_formula_lines").insert(rows.slice(i, i + 200)); if (r.error) throw r.error; res.lines += Math.min(200, rows.length - i); }
      }
      setDone(res); setData(null); reload();
    } catch (x) { setErr(x.message || "The import stopped. Nothing already saved is lost; you can run it again and it skips what is there."); }
    setBusy(false);
  };
  return (
    <div className="ipanel"><div className="ipanel-head"><div><h3>📥 Load products and ingredients from existing MSDS files</h3><p>One-time load of the file prepared from your Drive. Safe to repeat: products and ingredients already there are skipped. Everything loaded is marked “To verify”.</p></div></div>
      <input type="file" accept=".json,application/json" onChange={onFile} />
      {err && <div className="mt-dup">{err}</div>}
      {data && <div style={{ marginTop: 10 }}><div><b>{data.products.length}</b> products with <b>{data.products.reduce((a, p) => a + p.lines.length, 0)}</b> formula lines, <b>{data.ingredients.length}</b> supplier ingredient sheets and <b>{(data.stubs || []).length}</b> common ingredients.</div>
        <button className="btn-primary" style={{ marginTop: 8 }} onClick={run1} disabled={busy}>{busy ? "Loading… please wait" : "Load it"}</button></div>}
      {done && <div className="mt-dup" style={{ background: "#ecfdf5", color: "#166534" }}>✅ Added {done.prod} products ({done.lines} formula lines, {done.linked} linked to the ingredient library) and {done.ing} ingredients. Skipped {done.prodSkip} products and {done.ingSkip} ingredients that were already there.</div>}
    </div>
  );
}
