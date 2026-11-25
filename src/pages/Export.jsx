import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { Modal, Field, Empty, SearchBox, useConfirm } from "../components/ui";
import { FIRM_COLORS } from "./compliance/common";
import Shipments from "./ExportShipments";
import { FIRM_IDS, readProductSheet, planImport, normName, FIELD_LABEL } from "../lib/export";

// Export: masters that every export document is built from (firms and signatories, buyers / consignees / brand owners, agents,
// products with carton data and prices, and the document set each country needs). Shipments and document preparation come next.

const txt = (v) => { const s = String(v ?? "").trim(); return s || null; };
const nm = (v) => { const s = String(v ?? "").replace(/,/g, "").trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const lines = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
const FIRM_NAME = { VH: "Velite Healthcare", VI: "Velite India" };
const ROLES = [["buyer", "Buyer"], ["consignee", "Consignee"], ["notify", "Notify party"], ["brand_owner", "Brand owner"]];
const KINDS = [["transporter", "Transporter"], ["cha", "Customs agent (CHA)"], ["forwarder", "Freight forwarder"], ["other", "Other"]];
const FirmTag = ({ id }) => <span className="tk-firm" style={{ background: FIRM_COLORS[id] }}>{id}</span>;

export default function Export() {
  const { expFirms, expParties, expAgents, expProducts, expPrices, expCountries, isOwner } = useData();
  const [view, setView] = useState("shipments");
  const firms = expFirms.rows;
  const parties = useMemo(() => expParties.rows.filter((r) => !r.deleted_at), [expParties.rows]);
  const agents = useMemo(() => expAgents.rows.filter((r) => !r.deleted_at), [expAgents.rows]);
  const products = useMemo(() => expProducts.rows.filter((r) => !r.deleted_at), [expProducts.rows]);
  const countries = expCountries.rows;
  const tabs = [["shipments", "📦 Shipments"], ["overview", "🏠 Overview"], ["products", `🧴 Products (${products.length})`], ["parties", `🤝 Parties (${parties.length})`], ["firms", "🏢 Our firms"], ["countries", `🌍 Countries (${countries.length})`], ["agents", `🚚 Agents (${agents.length})`]];
  return (
    <div className="section qcp">
      <div className="mt-hero ex-hero"><div><div className="mt-hero-title">🚢 Export</div>
        <div className="mt-hero-sub">Firms, parties, products and country rules · the base for preparing and checking export documents</div></div></div>
      <div className="tk-views qc-tabs">{tabs.map(([k, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}</div>
      {view === "shipments" ? <Shipments />
        : view === "overview" ? <Overview firms={firms} parties={parties} products={products} prices={expPrices.rows} countries={countries} go={setView} />
        : view === "products" ? <Products products={products} prices={expPrices.rows} parties={parties} reloadAll={() => { expProducts.reload(); expPrices.reload(); }} />
        : view === "parties" ? <Parties rows={parties} countries={countries} reload={expParties.reload} />
        : view === "firms" ? <Firms rows={firms} reload={expFirms.reload} />
        : view === "countries" ? <Countries rows={countries} reload={expCountries.reload} isOwner={isOwner} />
        : <Agents rows={agents} reload={expAgents.reload} />}
    </div>
  );
}

// ── overview ─────────────────────────────────────────────────────────────
const FIRM_NEEDS = [["address", "address"], ["iec", "IEC"], ["gstin", "GSTIN"], ["pan", "PAN"], ["dl_no", "drug licence no."], ["signatory_name", "signatory"], ["email", "email"], ["phone", "phone"]];
const BANK_NEEDS = [["bank", "bank name"], ["account", "account no."], ["ifsc", "IFSC"], ["swift", "SWIFT"], ["ad_code", "AD code"]];
const LUT_NEEDS = [["no", "LUT number"], ["date", "LUT date"]];
const firmGaps = (f) => [...FIRM_NEEDS.filter(([k]) => !f[k]).map(([, l]) => l), ...BANK_NEEDS.filter(([k]) => !(f.bank || {})[k]).map(([, l]) => l), ...LUT_NEEDS.filter(([k]) => !(f.lut || {})[k]).map(([, l]) => l)];
const partyGaps = (p, countries) => { const c = countries.find((x) => x.country === p.country); return (c?.party_ids || []).filter((k) => !(p.ids || {})[k]); };

function Overview({ firms, parties, products, prices, countries, go }) {
  const withRate = new Set(prices.map((p) => p.product_id));
  const noHsn = products.filter((p) => !p.hsn), noCarton = products.filter((p) => !p.pcs_per_carton || !p.net_kg || !p.gross_kg), noRate = products.filter((p) => !withRate.has(p.id));
  const flagged = products.filter((p) => p.check_note);
  const partyGap = parties.filter((p) => partyGaps(p, countries).length);
  const Card = ({ n, t, c, onClick }) => <button className={`mt-kpi ${c}`} onClick={onClick}><b>{n}</b><span>{t}</span></button>;
  const Row = ({ t, s, to }) => <div className="qc-row"><span className="qc-row-main"><b>{t}</b>{s && <small>{s}</small>}</span><button className="btn-ghost sm" onClick={() => go(to)}>Open</button></div>;
  const todo = [];
  firms.forEach((f) => { const g = firmGaps(f); if (g.length) todo.push(<Row key={f.id} t={`${f.name}: ${g.length} details missing`} s={g.join(", ")} to="firms" />); });
  if (partyGap.length) todo.push(<Row key="pg" t={`${partyGap.length} parties are missing an ID their country needs`} s={partyGap.slice(0, 4).map((p) => `${p.name} (${partyGaps(p, countries).join(", ")})`).join(" · ")} to="parties" />);
  if (noHsn.length) todo.push(<Row key="h" t={`${noHsn.length} products have no HSN code`} to="products" />);
  if (noCarton.length) todo.push(<Row key="c" t={`${noCarton.length} products lack carton data (pieces per carton, net or gross weight)`} s="Upload your product data sheet, or fill them in one by one." to="products" />);
  if (noRate.length) todo.push(<Row key="r" t={`${noRate.length} products have no export price`} to="products" />);
  if (flagged.length) todo.push(<Row key="f" t={`${flagged.length} products carry a “please check” note from the past shipments`} s="For example an HSN or carton weight that differed between shipments." to="products" />);
  return (
    <>
      <div className="mt-kpis" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Card n={products.length} t="products" c="blue" onClick={() => go("products")} />
        <Card n={parties.length} t="parties" c="teal" onClick={() => go("parties")} />
        <Card n={countries.length} t="countries with rules" c="green" onClick={() => go("countries")} />
        <Card n={flagged.length} t="products to check" c="amber" onClick={() => go("products")} />
      </div>
      <div className="ipanel"><div className="ipanel-head"><div><h3>What to complete</h3><p>The documents will be built from these details, so gaps here become gaps in the papers.</p></div></div>
        {todo.length ? todo : <Empty>Everything needed is filled in. 👍</Empty>}
      </div>
      <div className="ipanel"><div className="ipanel-head"><div><h3>Coming next</h3></div></div>
        <div className="small-muted">Automatic preparation of the proforma, invoice, packing list and the other papers from a shipment, the audit that compares them, and the record of every shipment with outside documents added. Documents will show the signatory’s name only: you print on the letterhead, stamp and sign by hand.</div></div>
    </>
  );
}

// ── products ─────────────────────────────────────────────────────────────
function Products({ products, prices, parties, reloadAll }) {
  const [q, setQ] = useState(""); const [firm, setFirm] = useState(""); const [only, setOnly] = useState(""); const [edit, setEdit] = useState(null); const [upload, setUpload] = useState(false);
  const latest = useMemo(() => { const m = {}; prices.filter((p) => !p.party_id).forEach((p) => { const o = m[p.product_id]; if (!o || (p.as_of || "") >= (o.as_of || "")) m[p.product_id] = p; }); return m; }, [prices]);
  const hasPrice = useMemo(() => new Set(prices.map((p) => p.product_id)), [prices]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => (!firm || p.firm_id === firm) && (!s || [p.name, p.hsn, p.brand_owner].join(" ").toLowerCase().includes(s))
      && (!only || (only === "check" ? p.check_note : only === "carton" ? (!p.pcs_per_carton || !p.net_kg || !p.gross_kg) : only === "rate" ? !hasPrice.has(p.id) : !p.hsn)))
      .sort((a, b) => a.firm_id.localeCompare(b.firm_id) || a.name.localeCompare(b.name));
  }, [products, q, firm, only, hasPrice]);
  return (
    <>
      <div className="qc-filters" style={{ marginBottom: 8 }}>
        <div className="rg-search" style={{ flex: 1, minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="🔎 Search product, HSN, brand owner…" /></div>
        <select className="inp inp-filter" value={firm} onChange={(e) => setFirm(e.target.value)}><option value="">Both firms</option>{FIRM_IDS.map((x) => <option key={x} value={x}>{FIRM_NAME[x]}</option>)}</select>
        <select className="inp inp-filter" value={only} onChange={(e) => setOnly(e.target.value)}><option value="">All products</option><option value="check">With a “please check” note</option><option value="carton">Missing carton data</option><option value="rate">Without a price</option><option value="hsn">Without HSN</option></select>
        <button className="btn-ghost sm" onClick={() => setUpload(true)}>📥 Upload product data sheet</button>
        <button className="btn-primary sm" onClick={() => setEdit({})}>＋ New product</button>
      </div>
      {list.length === 0 ? <Empty>{products.length ? "No product matches." : "No products yet. Upload your product data sheet or add one."}</Empty> : (
        <div className="table-wrap"><table className="tbl qc-tbl"><thead><tr><th>Product</th><th>HSN</th><th>Pcs / carton</th><th>Net / gross kg</th><th>Carton size</th><th>Price</th><th></th></tr></thead>
          <tbody>{list.map((p) => { const pr = latest[p.id]; return (
            <tr key={p.id} className="qc-tr" onClick={() => setEdit(p)}>
              <td><FirmTag id={p.firm_id} /><b>{p.name}</b>{p.brand_owner && <small className="small-muted"> · {p.brand_owner}</small>}</td>
              <td>{p.hsn || "—"}</td><td>{p.pcs_per_carton ?? "—"}</td><td>{p.net_kg != null || p.gross_kg != null ? `${p.net_kg ?? "?"} / ${p.gross_kg ?? "?"}` : "—"}</td><td>{p.carton_size || "—"}</td>
              <td>{pr ? `${pr.currency} ${pr.rate}` : hasPrice.has(p.id) ? "party rates" : "—"}</td>
              <td title={p.check_note || ""}>{p.check_note ? "⚠️" : ""}</td></tr>); })}</tbody></table></div>)}
      <div className="small-muted" style={{ marginTop: 6 }}>{list.length} of {products.length} products</div>
      {edit && <ProductForm row={edit.id ? edit : null} prices={prices.filter((x) => x.product_id === edit.id)} parties={parties} onClose={() => setEdit(null)} onSaved={reloadAll} />}
      {upload && <DataSheet products={products} onClose={() => setUpload(false)} onDone={reloadAll} />}
    </>
  );
}

function ProductForm({ row, prices, parties, onClose, onSaved }) {
  const { isOwner, canReg, regProducts } = useData();
  const [ask, dialog] = useConfirm();
  const [f, setF] = useState(() => ({ firm_id: row?.firm_id || "VH", name: row?.name || "", hsn: row?.hsn || "", pcs_per_carton: row?.pcs_per_carton ?? "", net_kg: row?.net_kg ?? "", gross_kg: row?.gross_kg ?? "",
    carton_size: row?.carton_size || "", shelf_life_months: row?.shelf_life_months ?? "", brand_owner: row?.brand_owner || "", reg_product_id: row?.reg_product_id || "", check_note: row?.check_note || "", notes: row?.notes || "" }));
  const [pr, setPr] = useState(() => prices.map((x) => ({ id: x.id, party_id: x.party_id || "", currency: x.currency, rate: x.rate, as_of: x.as_of || "", note: x.note || "" })));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const regOptions = canReg ? regProducts.rows.filter((r) => !r.deleted_at) : [];
  const setP = (i, k, v) => setPr((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async () => {
    if (!f.name.trim()) { toast("Enter the product name", "err"); return; }
    for (const x of pr) if (nm(x.rate) == null) { toast("Every price line needs a rate", "err"); return; }
    setBusy(true);
    const body = { firm_id: f.firm_id, name: f.name.trim(), hsn: txt(f.hsn)?.replace(/\D/g, "") || null, pcs_per_carton: nm(f.pcs_per_carton) != null ? Math.round(nm(f.pcs_per_carton)) : null, net_kg: nm(f.net_kg), gross_kg: nm(f.gross_kg),
      carton_size: txt(f.carton_size), shelf_life_months: nm(f.shelf_life_months) != null ? Math.round(nm(f.shelf_life_months)) : null, brand_owner: txt(f.brand_owner), reg_product_id: f.reg_product_id || null, check_note: txt(f.check_note), notes: txt(f.notes) };
    let id = row?.id;
    const r = id ? await run(supabase.from("exp_products").update(body).eq("id", id)) : await run(supabase.from("exp_products").insert({ ...body, source: "manual" }).select("id").single());
    if (!r.ok) { setBusy(false); return; }
    if (!id) id = r.data.id;
    const keep = new Set(pr.filter((x) => x.id).map((x) => x.id));
    const gone = prices.filter((x) => !keep.has(x.id)).map((x) => x.id);
    if (gone.length) { const d = await run(supabase.from("exp_prices").delete().in("id", gone)); if (!d.ok) { setBusy(false); return; } }
    for (const x of pr) {
      const pb = { product_id: id, party_id: x.party_id || null, currency: x.currency, rate: nm(x.rate), as_of: x.as_of || null, note: txt(x.note) };
      const w = x.id ? await run(supabase.from("exp_prices").update(pb).eq("id", x.id)) : await run(supabase.from("exp_prices").insert(pb));
      if (!w.ok) { setBusy(false); return; }
    }
    setBusy(false); toast("Product saved"); onSaved(); onClose();
  };
  const del = async () => {
    if (!(await ask({ title: `Remove ${row.name}?`, body: "It disappears from the lists. Papers already made are not affected.", okText: "Remove", danger: true }))) return;
    const r = await run(supabase.from("exp_products").update({ deleted_at: new Date().toISOString() }).eq("id", row.id), "Product removed"); if (r.ok) { onSaved(); onClose(); }
  };
  return (
    <Modal wide title={row ? row.name : "New product"} onClose={onClose}
      actions={<>{row && isOwner && <button className="btn-danger" onClick={del} style={{ marginRight: "auto" }}>Remove</button>}<button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      {row?.check_note && <div className="mt-dup">⚠️ {row.check_note}</div>}
      <div className="ex-grid">
        <Field label="Exporting firm"><select className="form-inp" value={f.firm_id} onChange={set("firm_id")}>{FIRM_IDS.map((x) => <option key={x} value={x}>{FIRM_NAME[x]}</option>)}</select></Field>
        <Field label="Product name (as on the invoice)"><input className="form-inp" value={f.name} onChange={set("name")} placeholder="e.g. AZELUX AZ SERUM 30ML" /></Field>
        <Field label="HSN code"><input className="form-inp" value={f.hsn} onChange={set("hsn")} inputMode="numeric" /></Field>
        <Field label="Pieces per carton"><input className="form-inp" value={f.pcs_per_carton} onChange={set("pcs_per_carton")} inputMode="numeric" /></Field>
        <Field label="Net weight of a full carton (kg)"><input className="form-inp" value={f.net_kg} onChange={set("net_kg")} inputMode="decimal" /></Field>
        <Field label="Gross weight of a full carton (kg)"><input className="form-inp" value={f.gross_kg} onChange={set("gross_kg")} inputMode="decimal" /></Field>
        <Field label="Carton size (inches)" hint="length x breadth x height"><input className="form-inp" value={f.carton_size} onChange={set("carton_size")} placeholder="16.2 x 12.2 x 11.2" /></Field>
        <Field label="Shelf life (months)"><input className="form-inp" value={f.shelf_life_months} onChange={set("shelf_life_months")} inputMode="numeric" /></Field>
        <Field label="Brand owner" hint="Only if the brand belongs to another company."><input className="form-inp" value={f.brand_owner} onChange={set("brand_owner")} /></Field>
        {regOptions.length > 0 && <Field label="Linked Regulatory product" hint="Gives the MSDS and formula later."><select className="form-inp" value={f.reg_product_id} onChange={set("reg_product_id")}><option value="">Not linked</option>{regOptions.sort((a, b) => a.name.localeCompare(b.name)).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.firm_id})</option>)}</select></Field>}
      </div>
      <Field label="Please check note"><input className="form-inp" value={f.check_note} onChange={set("check_note")} placeholder="Leave empty once confirmed" /></Field>
      <Field label="Notes"><textarea className="form-inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      <div className="form-label" style={{ marginTop: 8 }}>Export prices</div>
      {pr.map((x, i) => (
        <div key={i} className="ex-price">
          <select className="form-inp" value={x.party_id} onChange={(e) => setP(i, "party_id", e.target.value)}><option value="">Any party</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select className="form-inp" value={x.currency} onChange={(e) => setP(i, "currency", e.target.value)}><option>INR</option><option>USD</option></select>
          <input className="form-inp" value={x.rate} onChange={(e) => setP(i, "rate", e.target.value)} inputMode="decimal" placeholder="Rate per piece" />
          <input className="form-inp" type="date" value={x.as_of} onChange={(e) => setP(i, "as_of", e.target.value)} />
          <button className="btn-ghost sm" onClick={() => setPr((l) => l.filter((_, j) => j !== i))}>✕</button>
        </div>))}
      <button className="btn-ghost sm" onClick={() => setPr((l) => [...l, { party_id: "", currency: "INR", rate: "", as_of: new Date().toISOString().slice(0, 10), note: "" }])}>＋ Add a price</button>
      {dialog}
    </Modal>
  );
}

// product data sheet upload: read, compare, show what would change, then apply
function DataSheet({ products, onClose, onDone }) {
  const [res, setRes] = useState(null); const [file, setFile] = useState(""); const [def, setDef] = useState("VH"); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [err, setErr] = useState("");
  const plan = useMemo(() => (res ? planImport(res.rows, products, def) : []), [res, products, def]);
  const count = (k) => plan.filter((p) => p.kind === k).length;
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setErr(""); setDone(null); setFile(f.name);
    try { const r = readProductSheet(XLSX, await f.arrayBuffer()); if (!r.rows.length) throw new Error("x"); setRes(r); }
    catch { setRes(null); setErr("I could not find a product table in this file. It needs a heading row with at least Product and HSN (or pieces per carton)."); }
  };
  const apply = async () => {
    setBusy(true); let added = 0, updated = 0;
    try {
      const today = new Date().toISOString().slice(0, 10);
      for (const p of plan) {
        if (p.kind === "dup" || p.kind === "same") continue;
        const r = p.row; const vals = { hsn: r.hsn, pcs_per_carton: r.pcs_per_carton, net_kg: r.net_kg, gross_kg: r.gross_kg, carton_size: r.carton_size, shelf_life_months: r.shelf_life_months, brand_owner: r.brand_owner, check_note: r.check_note, last_seen: r.last_seen };
        const body = Object.fromEntries(Object.entries(vals).filter(([, v]) => v != null));
        let id = p.have?.id;
        if (p.kind === "new") { const i = await supabase.from("exp_products").insert({ firm_id: p.firm, name: r.name, source: "upload", ...body }).select("id").single(); if (i.error) throw i.error; id = i.data.id; added++; }
        else { if (Object.keys(body).length) { const u = await supabase.from("exp_products").update(body).eq("id", id); if (u.error) throw u.error; } updated++; }
        if (r.rate != null) {
          const cur = r.currency || "INR";
          const { data: have } = await supabase.from("exp_prices").select("id,rate,currency").eq("product_id", id).is("party_id", null).order("as_of", { ascending: false }).limit(1);
          if (!have?.length || Number(have[0].rate) !== r.rate || have[0].currency !== cur) { const w = await supabase.from("exp_prices").insert({ product_id: id, currency: cur, rate: r.rate, as_of: r.last_seen || today, note: `From ${file}` }); if (w.error) throw w.error; }
        }
      }
      await supabase.from("exp_uploads").insert({ file_name: file, rows_read: res.rows.length, added, updated, skipped: count("same") + count("dup"), summary: `Sheet "${res.sheet}"` });
      setDone({ added, updated }); setRes(null); onDone();
    } catch (x) { setErr(x.message || "The upload stopped. What was saved stays; you can run it again."); }
    setBusy(false);
  };
  return (
    <Modal wide title="Upload product data sheet" onClose={onClose} actions={<><button className="btn-ghost" onClick={onClose}>Close</button>{res && !done && <button className="btn-primary" onClick={apply} disabled={busy || count("new") + count("change") === 0}>{busy ? "Saving…" : `Apply ${count("new") + count("change")} changes`}</button>}</>}>
      <p className="small-muted">An Excel or CSV sheet with one row per product. Headings I recognise: Firm, Product, HSN, Pieces per carton, Net weight, Gross weight, Carton size, Rate, Currency, Shelf life, Brand owner, Please check. Blank cells never erase what is already stored. The sheet you got from me works as it is.</p>
      <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} />
      {err && <div className="mt-dup">{err}</div>}
      {res && (<div style={{ marginTop: 10 }}>
        <div>Read <b>{res.rows.length}</b> rows from “{res.sheet}”. Found columns: {res.found.join(", ")}.</div>
        {res.rows.some((r) => !r.firm) && <div style={{ marginTop: 6 }}>Rows with no firm belong to <select className="inp inp-filter" value={def} onChange={(e) => setDef(e.target.value)}>{FIRM_IDS.map((x) => <option key={x} value={x}>{FIRM_NAME[x]}</option>)}</select></div>}
        <div className="mt-kpis" style={{ marginTop: 8, gridTemplateColumns: "repeat(4,1fr)" }}>
          <div className="mt-kpi green"><b>{count("new")}</b><span>new</span></div><div className="mt-kpi amber"><b>{count("change")}</b><span>to update</span></div>
          <div className="mt-kpi blue"><b>{count("same")}</b><span>already the same</span></div><div className="mt-kpi rose"><b>{count("dup")}</b><span>repeated in the sheet</span></div></div>
        {plan.filter((p) => p.kind === "change" && p.diffs.length).slice(0, 12).map((p, i) => <div key={i} className="rg-note grey"><b>{p.have.name}</b>: {p.diffs.map((d) => `${FIELD_LABEL[d]} ${p.have[d] ?? "empty"} → ${p.row[d]}`).join(", ")}</div>)}
        {plan.filter((p) => p.kind === "dup").slice(0, 6).map((p, i) => <div key={i} className="rg-note amber">Repeated: {p.row.name} (row {p.row.line}) — only the first one is used.</div>)}
      </div>)}
      {done && <div className="mt-dup" style={{ background: "#ecfdf5", color: "#166534" }}>✅ Added {done.added} products and updated {done.updated}.</div>}
    </Modal>
  );
}

// ── parties ──────────────────────────────────────────────────────────────
function Parties({ rows, countries, reload }) {
  const [q, setQ] = useState(""); const [edit, setEdit] = useState(null);
  const list = useMemo(() => { const s = q.trim().toLowerCase(); return rows.filter((r) => !s || [r.name, r.country, r.address, Object.values(r.ids || {}).join(" ")].join(" ").toLowerCase().includes(s)); }, [rows, q]);
  const byCountry = useMemo(() => { const m = {}; list.forEach((r) => (m[r.country] ||= []).push(r)); return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0])); }, [list]);
  return (
    <>
      <div className="qc-filters" style={{ marginBottom: 8 }}>
        <div className="rg-search" style={{ flex: 1, minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="🔎 Search name, country, PAN, EXIM…" /></div>
        <button className="btn-primary sm" onClick={() => setEdit({})}>＋ New party</button>
      </div>
      {byCountry.length === 0 ? <Empty>No parties yet.</Empty> : byCountry.map(([c, items]) => (
        <div key={c} className="rg-group"><h3>{c} <span className="section-count">{items.length}</span></h3>
          <div className="table-wrap"><table className="tbl qc-tbl"><thead><tr><th>Party</th><th>Roles</th><th>IDs</th><th>Usual firm</th><th>Currency</th></tr></thead>
            <tbody>{items.map((p) => { const gaps = partyGaps(p, countries); return (
              <tr key={p.id} className="qc-tr" onClick={() => setEdit(p)}><td><b>{p.name}</b>{gaps.length > 0 && <small style={{ color: "#b45309" }}> · missing {gaps.join(", ")}</small>}</td>
                <td>{(p.roles || []).map((r) => ROLES.find((x) => x[0] === r)?.[1] || r).join(", ")}</td>
                <td>{Object.entries(p.ids || {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</td><td>{p.usual_firm ? <FirmTag id={p.usual_firm} /> : "—"}</td><td>{p.currency}</td></tr>); })}</tbody></table></div></div>))}
      {edit && <PartyForm row={edit.id ? edit : null} countries={countries} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

function PartyForm({ row, countries, onClose, onSaved }) {
  const { isOwner } = useData(); const [ask, dialog] = useConfirm();
  const [f, setF] = useState(() => ({ name: row?.name || "", country: row?.country || "", roles: row?.roles || ["buyer", "consignee"], address: row?.address || "", contact_person: row?.contact_person || "", phone: row?.phone || "", email: row?.email || "",
    currency: row?.currency || "INR", usual_firm: row?.usual_firm || "", payment_terms: row?.payment_terms || "", delivery_terms: row?.delivery_terms || "", entry_point: row?.entry_point || "", notes: row?.notes || "" }));
  const [au, setAu] = useState(() => ({ representative: "", authority: "", trademarks: "", valid_from: "", valid_to: "", ...(row?.authority || {}) }));
  const [ids, setIds] = useState(() => { const e = Object.entries(row?.ids || {}); return e.length ? e.map(([k, v]) => ({ k, v })) : []; });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const c = countries.find((x) => x.country.toLowerCase() === f.country.trim().toLowerCase());
  const missing = (c?.party_ids || []).filter((k) => !ids.some((x) => x.k.trim().toLowerCase() === k.toLowerCase() && x.v.trim()));
  const toggle = (r) => setF((x) => ({ ...x, roles: x.roles.includes(r) ? x.roles.filter((y) => y !== r) : [...x.roles, r] }));
  const save = async () => {
    if (!f.name.trim() || !f.country.trim()) { toast("Enter the party name and country", "err"); return; }
    setBusy(true);
    const body = { name: f.name.trim(), country: f.country.trim(), roles: f.roles, address: txt(f.address), contact_person: txt(f.contact_person), phone: txt(f.phone), email: txt(f.email), currency: f.currency, usual_firm: f.usual_firm || null,
      payment_terms: txt(f.payment_terms), delivery_terms: txt(f.delivery_terms), entry_point: txt(f.entry_point), notes: txt(f.notes), ids: Object.fromEntries(ids.filter((x) => x.k.trim() && x.v.trim()).map((x) => [x.k.trim(), x.v.trim()])), authority: Object.fromEntries(Object.entries(au).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v)) };
    const r = row ? await run(supabase.from("exp_parties").update(body).eq("id", row.id), "Party saved") : await run(supabase.from("exp_parties").insert(body), "Party added");
    setBusy(false); if (r.ok) { onSaved(); onClose(); }
  };
  const del = async () => {
    if (!(await ask({ title: `Remove ${row.name}?`, body: "It disappears from the lists.", okText: "Remove", danger: true }))) return;
    const r = await run(supabase.from("exp_parties").update({ deleted_at: new Date().toISOString() }).eq("id", row.id), "Party removed"); if (r.ok) { onSaved(); onClose(); }
  };
  return (
    <Modal wide title={row ? row.name : "New party"} onClose={onClose}
      actions={<>{row && isOwner && <button className="btn-danger" onClick={del} style={{ marginRight: "auto" }}>Remove</button>}<button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="ex-grid">
        <Field label="Name"><input className="form-inp" value={f.name} onChange={set("name")} /></Field>
        <Field label="Country"><input className="form-inp" list="ex-countries" value={f.country} onChange={set("country")} /></Field>
        <Field label="Phone"><input className="form-inp" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Email"><input className="form-inp" value={f.email} onChange={set("email")} /></Field>
        <Field label="Contact person"><input className="form-inp" value={f.contact_person} onChange={set("contact_person")} /></Field>
        <Field label="Usual exporting firm"><select className="form-inp" value={f.usual_firm} onChange={set("usual_firm")}><option value="">Not fixed</option>{FIRM_IDS.map((x) => <option key={x} value={x}>{FIRM_NAME[x]}</option>)}</select></Field>
        <Field label="Invoice currency"><select className="form-inp" value={f.currency} onChange={set("currency")}><option>INR</option><option>USD</option></select></Field>
        <Field label="Entry point / port"><input className="form-inp" value={f.entry_point} onChange={set("entry_point")} /></Field>
      </div>
      <datalist id="ex-countries">{countries.map((x) => <option key={x.country} value={x.country} />)}</datalist>
      <Field label="Address (as it must print)"><textarea className="form-inp" rows={2} value={f.address} onChange={set("address")} /></Field>
      <Field label="This party can be"><div>{ROLES.map(([k, l]) => <label key={k} style={{ marginRight: 14 }}><input type="checkbox" checked={f.roles.includes(k)} onChange={() => toggle(k)} /> {l}</label>)}</div></Field>
      <div className="form-label">IDs {c && <small className="small-muted">({c.country} needs: {c.party_ids.join(", ") || "none listed"})</small>}</div>
      {ids.map((x, i) => (
        <div key={i} className="ex-price" style={{ gridTemplateColumns: "1fr 2fr auto" }}>
          <input className="form-inp" list="ex-idkeys" value={x.k} onChange={(e) => setIds((l) => l.map((y, j) => (j === i ? { ...y, k: e.target.value } : y)))} placeholder="PAN" />
          <input className="form-inp" value={x.v} onChange={(e) => setIds((l) => l.map((y, j) => (j === i ? { ...y, v: e.target.value } : y)))} placeholder="number" />
          <button className="btn-ghost sm" onClick={() => setIds((l) => l.filter((_, j) => j !== i))}>✕</button></div>))}
      <datalist id="ex-idkeys">{["PAN", "EXIM", "E-TIN", "BIN", "IRC", "GST", "Company reg."].map((k) => <option key={k} value={k} />)}</datalist>
      <button className="btn-ghost sm" onClick={() => setIds((l) => [...l, { k: "", v: "" }])}>＋ Add an ID</button>
      {missing.length > 0 && <div className="rg-note amber">Not yet entered: {missing.join(", ")}</div>}
      <div className="ex-grid" style={{ marginTop: 8 }}>
        <Field label="Usual payment terms"><input className="form-inp" value={f.payment_terms} onChange={set("payment_terms")} /></Field>
        <Field label="Usual delivery terms"><input className="form-inp" value={f.delivery_terms} onChange={set("delivery_terms")} /></Field>
      </div>
      <div className="form-label" style={{ marginTop: 8 }}>Letter of authority <small className="small-muted">(only for countries that need one, such as Myanmar)</small></div>
      <div className="ex-grid">
        <Field label="Authorised person (named on the letter)"><input className="form-inp" value={au.representative} onChange={(e) => setAu((x) => ({ ...x, representative: e.target.value }))} placeholder="Mr. Wai Lynn Htun" /></Field>
        <Field label="Authority they deal with"><input className="form-inp" value={au.authority} onChange={(e) => setAu((x) => ({ ...x, authority: e.target.value }))} placeholder="Food and Drug Administration, Myanmar" /></Field>
        <Field label="Trademark(s)" hint="Separate with commas"><input className="form-inp" value={au.trademarks} onChange={(e) => setAu((x) => ({ ...x, trademarks: e.target.value }))} placeholder="CutaPro, Cutacare" /></Field>
        <div className="ex-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Field label="Valid from"><input className="form-inp" type="month" value={au.valid_from} onChange={(e) => setAu((x) => ({ ...x, valid_from: e.target.value }))} /></Field>
          <Field label="Valid to"><input className="form-inp" type="month" value={au.valid_to} onChange={(e) => setAu((x) => ({ ...x, valid_to: e.target.value }))} /></Field>
        </div>
      </div>
      <Field label="Notes"><textarea className="form-inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      {dialog}
    </Modal>
  );
}

// ── our firms ────────────────────────────────────────────────────────────
function Firms({ rows, reload }) {
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="small-muted" style={{ marginBottom: 8 }}>These details print on every document. The signatory’s <b>name</b> is printed under “For {"{firm}"}”; the Hub never adds a signature or stamp. You print on the letterhead, stamp and sign.</div>
      {rows.map((f) => { const g = firmGaps(f); return (
        <div key={f.id} className="ipanel"><div className="ipanel-head"><div><h3><FirmTag id={f.id} /> {f.name}</h3><p>{f.address || "No address yet"}</p></div><button className="btn-ghost sm" onClick={() => setEdit(f)}>Edit</button></div>
          <div className="ex-facts">
            <span><b>IEC</b> {f.iec || "—"}</span><span><b>GSTIN</b> {f.gstin || "—"}</span><span><b>PAN</b> {f.pan || "—"}</span><span><b>Drug licence</b> {f.dl_no || "—"}</span>
            <span><b>Signatory</b> {f.signatory_name ? `${f.signatory_name}, ${f.signatory_title || ""}` : "—"}</span><span><b>Bank a/c</b> {(f.bank || {}).account || "—"}</span><span><b>IFSC</b> {(f.bank || {}).ifsc || "—"}</span><span><b>LUT</b> {(f.lut || {}).no || "—"}</span></div>
          {f.notes && <div className="rg-note amber">{f.notes}</div>}
          {g.length > 0 && <div className="rg-note grey">Still to enter: {g.join(", ")}</div>}</div>); })}
      {edit && <FirmForm row={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

function FirmForm({ row, onClose, onSaved }) {
  const [f, setF] = useState(() => ({ name: row.name || "", address: row.address || "", phone: row.phone || "", email: row.email || "", iec: row.iec || "", gstin: row.gstin || "", pan: row.pan || "", dl_no: row.dl_no || "",
    signatory_name: row.signatory_name || "", signatory_title: row.signatory_title || "", notes: row.notes || "" }));
  const [bank, setBank] = useState({ bank: "", branch: "", account: "", ifsc: "", swift: "", ad_code: "", ...(row.bank || {}) });
  const [lut, setLut] = useState({ no: "", date: "", valid_for: "", ...(row.lut || {}) });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const clean = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v).trim()]));
  const save = async () => {
    setBusy(true);
    const r = await run(supabase.from("exp_firms").update({ ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, txt(v)])), name: f.name.trim(), bank: clean(bank), lut: clean(lut) }).eq("id", row.id), "Saved");
    setBusy(false); if (r.ok) { onSaved(); onClose(); }
  };
  const B = (k, label) => <Field label={label}><input className="form-inp" value={bank[k]} onChange={(e) => setBank((x) => ({ ...x, [k]: e.target.value }))} /></Field>;
  return (
    <Modal wide title={row.name} onClose={onClose} actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="ex-grid">
        <Field label="Firm name"><input className="form-inp" value={f.name} onChange={set("name")} /></Field>
        <Field label="Phone"><input className="form-inp" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Email"><input className="form-inp" value={f.email} onChange={set("email")} /></Field>
        <Field label="IEC"><input className="form-inp" value={f.iec} onChange={set("iec")} /></Field>
        <Field label="GSTIN"><input className="form-inp" value={f.gstin} onChange={set("gstin")} /></Field>
        <Field label="PAN"><input className="form-inp" value={f.pan} onChange={set("pan")} /></Field>
        <Field label="Drug licence no."><input className="form-inp" value={f.dl_no} onChange={set("dl_no")} /></Field>
        <Field label="Signatory name" hint="Printed under “For the firm”. Never a signature image."><input className="form-inp" value={f.signatory_name} onChange={set("signatory_name")} /></Field>
        <Field label="Signatory title"><input className="form-inp" value={f.signatory_title} onChange={set("signatory_title")} /></Field>
      </div>
      <Field label="Address (as it must print)"><textarea className="form-inp" rows={2} value={f.address} onChange={set("address")} /></Field>
      <div className="form-label">Bank for export receipts</div>
      <div className="ex-grid">{B("bank", "Bank and address")}{B("branch", "Branch")}{B("account", "Account number")}{B("ifsc", "IFSC")}{B("swift", "SWIFT")}{B("ad_code", "AD code")}</div>
      <div className="form-label">Letter of Undertaking (LUT)</div>
      <div className="ex-grid">
        <Field label="LUT number"><input className="form-inp" value={lut.no} onChange={(e) => setLut((x) => ({ ...x, no: e.target.value }))} /></Field>
        <Field label="LUT date"><input className="form-inp" type="date" value={lut.date} onChange={(e) => setLut((x) => ({ ...x, date: e.target.value }))} /></Field>
        <Field label="Financial year"><input className="form-inp" value={lut.valid_for} onChange={(e) => setLut((x) => ({ ...x, valid_for: e.target.value }))} placeholder="2026-27" /></Field>
      </div>
      <Field label="Notes"><textarea className="form-inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
    </Modal>
  );
}

// ── country rules ────────────────────────────────────────────────────────
function Countries({ rows, reload, isOwner }) {
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="qc-filters" style={{ marginBottom: 8 }}><div className="small-muted" style={{ flex: 1 }}>What each country needs. A shipment will use this list to decide which papers to prepare and which party IDs to check. The starting lists come from your past shipments: please correct them.</div>
        <button className="btn-primary sm" onClick={() => setEdit({})}>＋ New country</button></div>
      {rows.length === 0 ? <Empty>No countries yet.</Empty> : rows.slice().sort((a, b) => a.country.localeCompare(b.country)).map((c) => (
        <div key={c.country} className="ipanel"><div className="ipanel-head"><div><h3>{c.country} <small className="small-muted">· {c.currency}</small></h3><p>{c.route || "Route not set"}</p></div><button className="btn-ghost sm" onClick={() => setEdit(c)}>Edit</button></div>
          <ol className="ex-docs">{c.docs.map((d, i) => <li key={i}>{d}</li>)}</ol>
          {c.party_ids.length > 0 && <div className="small-muted">Buyer must have: {c.party_ids.join(", ")}</div>}
          {c.label_rule && <div className="small-muted">{c.label_rule}</div>}
          {c.notes && <div className="rg-note grey">{c.notes}</div>}</div>))}
      {edit && <CountryForm row={edit.country ? edit : null} isOwner={isOwner} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

function CountryForm({ row, isOwner, onClose, onSaved }) {
  const [ask, dialog] = useConfirm();
  const [f, setF] = useState(() => ({ country: row?.country || "", currency: row?.currency || "USD", route: row?.route || "", docs: (row?.docs || []).join("\n"), party_ids: (row?.party_ids || []).join(", "), label_rule: row?.label_rule || "", notes: row?.notes || "" }));
  const [busy, setBusy] = useState(false); const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.country.trim()) { toast("Enter the country", "err"); return; }
    setBusy(true);
    const body = { currency: f.currency, route: txt(f.route), docs: lines(f.docs), party_ids: f.party_ids.split(/[,;]+/).map((x) => x.trim()).filter(Boolean), label_rule: txt(f.label_rule), notes: txt(f.notes) };
    const r = row ? await run(supabase.from("exp_countries").update(body).eq("country", row.country), "Saved") : await run(supabase.from("exp_countries").insert({ country: f.country.trim(), ...body }), "Country added");
    setBusy(false); if (r.ok) { onSaved(); onClose(); }
  };
  const del = async () => { if (!(await ask({ title: `Delete the rules for ${row.country}?`, okText: "Delete", danger: true }))) return; const r = await run(supabase.from("exp_countries").delete().eq("country", row.country), "Deleted"); if (r.ok) { onSaved(); onClose(); } };
  return (
    <Modal wide title={row ? row.country : "New country"} onClose={onClose}
      actions={<>{row && isOwner && <button className="btn-danger" onClick={del} style={{ marginRight: "auto" }}>Delete</button>}<button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="ex-grid">
        <Field label="Country"><input className="form-inp" value={f.country} onChange={set("country")} disabled={!!row} /></Field>
        <Field label="Usual invoice currency"><select className="form-inp" value={f.currency} onChange={set("currency")}><option>USD</option><option>INR</option></select></Field>
      </div>
      <Field label="Route and transport"><input className="form-inp" value={f.route} onChange={set("route")} /></Field>
      <Field label="Documents needed (one per line)"><textarea className="form-inp" rows={9} value={f.docs} onChange={set("docs")} /></Field>
      <Field label="IDs the buyer must have (comma separated)"><input className="form-inp" value={f.party_ids} onChange={set("party_ids")} placeholder="PAN, EXIM" /></Field>
      <Field label="Label or carton rule"><input className="form-inp" value={f.label_rule} onChange={set("label_rule")} /></Field>
      <Field label="Notes"><textarea className="form-inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      {dialog}
    </Modal>
  );
}

// ── agents ───────────────────────────────────────────────────────────────
function Agents({ rows, reload }) {
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="qc-filters" style={{ marginBottom: 8 }}><div className="small-muted" style={{ flex: 1 }}>Transporters, customs agents (CHA) and forwarders you use.</div><button className="btn-primary sm" onClick={() => setEdit({})}>＋ New</button></div>
      {rows.length === 0 ? <Empty>None yet.</Empty> : <div className="table-wrap"><table className="tbl qc-tbl"><thead><tr><th>Name</th><th>Type</th><th>City</th><th>Phone</th><th>Notes</th></tr></thead>
        <tbody>{rows.slice().sort((a, b) => a.name.localeCompare(b.name)).map((a) => <tr key={a.id} className="qc-tr" onClick={() => setEdit(a)}><td><b>{a.name}</b></td><td>{KINDS.find((k) => k[0] === a.kind)?.[1] || a.kind}</td><td>{a.city || "—"}</td><td>{a.phone || "—"}</td><td>{a.notes || ""}</td></tr>)}</tbody></table></div>}
      {edit && <AgentForm row={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

function AgentForm({ row, onClose, onSaved }) {
  const { isOwner } = useData(); const [ask, dialog] = useConfirm();
  const [f, setF] = useState({ name: row?.name || "", kind: row?.kind || "transporter", city: row?.city || "", phone: row?.phone || "", email: row?.email || "", notes: row?.notes || "" });
  const [busy, setBusy] = useState(false); const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.name.trim()) { toast("Enter the name", "err"); return; }
    setBusy(true); const body = { name: f.name.trim(), kind: f.kind, city: txt(f.city), phone: txt(f.phone), email: txt(f.email), notes: txt(f.notes) };
    const r = row ? await run(supabase.from("exp_agents").update(body).eq("id", row.id), "Saved") : await run(supabase.from("exp_agents").insert(body), "Added");
    setBusy(false); if (r.ok) { onSaved(); onClose(); }
  };
  const del = async () => { if (!(await ask({ title: `Remove ${row.name}?`, okText: "Remove", danger: true }))) return; const r = await run(supabase.from("exp_agents").update({ deleted_at: new Date().toISOString() }).eq("id", row.id), "Removed"); if (r.ok) { onSaved(); onClose(); } };
  return (
    <Modal title={row ? row.name : "New agent"} onClose={onClose}
      actions={<>{row && isOwner && <button className="btn-danger" onClick={del} style={{ marginRight: "auto" }}>Remove</button>}<button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <Field label="Name"><input className="form-inp" value={f.name} onChange={set("name")} /></Field>
      <Field label="Type"><select className="form-inp" value={f.kind} onChange={set("kind")}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="City"><input className="form-inp" value={f.city} onChange={set("city")} /></Field>
      <Field label="Phone"><input className="form-inp" value={f.phone} onChange={set("phone")} /></Field>
      <Field label="Email"><input className="form-inp" value={f.email} onChange={set("email")} /></Field>
      <Field label="Notes"><textarea className="form-inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      {dialog}
    </Modal>
  );
}
