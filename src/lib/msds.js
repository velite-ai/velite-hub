// Regulatory: the MSDS (material safety data sheet) for a finished product.
// A sheet is built from three things: the product's formula, what the ingredient library knows about each ingredient, and the standard
// wording in the template (editable by owners). The result is stored as plain data (header + 16 sections) so a person can edit every
// line before it is approved. Nothing here invents safety data: whatever cannot be worked out is left empty and listed in "reviewNotes".

export const FIRM_NAMES = { VH: "Velite Healthcare", VP: "Velite Pharmaceuticals", VI: "Velite India", VS: "Velite Sciences" };
export const TEMPLATE_KEY = "msds_template";

// standard wording. "auto" fields are filled from the product, the firm or the formula. Owners can change every text in Settings.
export const DEFAULT_TEMPLATE = {
  version: 1,
  validity_years: 3,
  sections: [
    { no: 1, title: "Identification of the product and of the company", fields: [
      { k: "product", label: "Product identifier", auto: "product" },
      { k: "use", label: "Intended use", text: "Cosmetic product for external use on skin or hair, as directed on the label." },
      { k: "company", label: "Manufacturer", auto: "company" },
      { k: "emergency", label: "Emergency contact", text: "In an emergency contact the manufacturer at the address above, or the nearest poison information centre or hospital." },
    ] },
    { no: 2, title: "Hazards identification", fields: [
      { k: "classification", label: "Classification of the product", text: "Not classified as hazardous under GHS for the finished cosmetic product when used as intended." },
      { k: "label", label: "Label elements", text: "No hazard pictogram and no signal word are required." },
      { k: "other", label: "Other hazards", text: "May cause mild skin or eye irritation in sensitive individuals. Floors may become slippery if the product is spilled." },
    ] },
    { no: 3, title: "Composition / information on ingredients", table: "composition", fields: [
      { k: "note", label: "Note", text: "Ingredients are listed with their INCI names. Percentages are by weight." },
    ] },
    { no: 4, title: "First aid measures", fields: [
      { k: "skin", label: "Skin contact", text: "Rinse the area with plenty of water. If irritation occurs and persists, seek medical advice." },
      { k: "eyes", label: "Eye contact", text: "Rinse with plenty of clean water for at least 15 minutes, holding the eyelids open. Do not rub the eyes. If irritation persists, consult a physician." },
      { k: "inhalation", label: "Inhalation", text: "Inhalation is unlikely. If discomfort occurs, move the person to fresh air." },
      { k: "ingestion", label: "Ingestion", text: "Rinse the mouth with water. Do not induce vomiting. Seek medical advice." },
    ] },
    { no: 5, title: "Fire-fighting measures", fields: [
      { k: "flammable", label: "Flammable", text: "No" },
      { k: "media", label: "Suitable extinguishing media", text: "Water spray, foam, carbon dioxide, dry chemical powder." },
      { k: "hazards", label: "Special hazards", text: "Not applicable for a water-based product." },
      { k: "advice", label: "Advice for fire-fighters", text: "Wear normal protective clothing and breathing apparatus if there is a large fire in the surroundings." },
    ] },
    { no: 6, title: "Accidental release measures", fields: [
      { k: "personal", label: "Personal precautions", text: "The floor may become slippery. Wear suitable footwear." },
      { k: "environment", label: "Environmental precautions", text: "Do not let large quantities enter drains or water courses." },
      { k: "cleanup", label: "Methods for clean-up", text: "Absorb with an inert material such as sand, earth or sawdust. Collect in a container for disposal. Wash the area with water and detergent." },
    ] },
    { no: 7, title: "Handling and storage", fields: [
      { k: "handling", label: "Safe handling", text: "Use as directed on the pack. Keep the container closed when not in use." },
      { k: "storage", label: "Storage", auto: "storage", text: "Store in a cool, dry, well-ventilated place, below 25 °C and away from direct sunlight." },
    ] },
    { no: 8, title: "Exposure controls / personal protection", fields: [
      { k: "engineering", label: "Engineering controls", text: "This is a personal care product that is safe for consumers and other users under normal and reasonably foreseeable use. No special controls are needed." },
      { k: "ppe", label: "Personal protective equipment", text: "Not required for normal use." },
    ] },
    { no: 9, title: "Physical and chemical properties", fields: [
      { k: "state", label: "Physical state", auto: "form" },
      { k: "appearance", label: "Appearance", auto: "appearance" },
      { k: "colour", label: "Colour", auto: "colour" },
      { k: "odour", label: "Odour", auto: "odour" },
      { k: "ph", label: "pH", auto: "ph" },
      { k: "boiling", label: "Boiling point", auto: "boiling", text: "Not determined" },
      { k: "flash", label: "Flash point", auto: "flash", text: "Not applicable" },
      { k: "density", label: "Relative density", auto: "density", text: "Not determined" },
      { k: "solubility", label: "Solubility in water", auto: "solubility" },
    ] },
    { no: 10, title: "Stability and reactivity", fields: [
      { k: "stability", label: "Chemical stability", text: "Stable under normal conditions of storage and use." },
      { k: "avoid", label: "Conditions to avoid", text: "Extreme heat and direct sunlight." },
      { k: "incompat", label: "Incompatible materials", text: "Strong oxidising agents. No other specific incompatibility is known." },
      { k: "decomp", label: "Hazardous decomposition products", text: "None are expected under normal conditions." },
    ] },
    { no: 11, title: "Toxicological information", fields: [
      { k: "acute", label: "Acute effects", text: "A personal care product that is safe for consumers and other users under the intended and reasonably foreseeable use." },
      { k: "irritation", label: "Skin and eye irritation", text: "Not expected to be irritating under normal use. Repeated or prolonged contact may cause irritation in sensitive individuals." },
      { k: "sensitisation", label: "Sensitisation", text: "Not expected to be a sensitiser. Discontinue use if a reaction occurs." },
      { k: "chronic", label: "Chronic effects", text: "The finished product is not expected to have chronic health effects." },
      { k: "cmr", label: "Carcinogenicity, mutagenicity, reproductive toxicity", text: "Not expected for the finished product." },
    ] },
    { no: 12, title: "Ecological information", fields: [
      { k: "eco", label: "Ecotoxicity", text: "No specific data for the finished product. The ingredients are not expected to harm the environment at the concentrations reached in normal use or in an accidental spill." },
    ] },
    { no: 13, title: "Disposal considerations", fields: [
      { k: "disposal", label: "Waste disposal", text: "Dispose of the product and its packaging according to local, state and national regulations. Do not pour large quantities into drains or the environment." },
    ] },
    { no: 14, title: "Transport information", fields: [
      { k: "road", label: "Road", text: "Not classified as dangerous goods." },
      { k: "rail", label: "Rail", text: "Not classified as dangerous goods." },
      { k: "air", label: "Air", text: "Not classified as dangerous goods." },
      { k: "sea", label: "Sea", text: "Not classified as dangerous goods." },
    ] },
    { no: 15, title: "Regulatory information", fields: [
      { k: "law", label: "Regulation", text: "Manufactured under the Drugs and Cosmetics Act, 1940 and the Cosmetics Rules, 2020.", },
      { k: "licence", label: "Manufacturing licence", auto: "licence" },
      { k: "hazchem", label: "Hazardous chemicals", text: "The product contains no ingredient classified as hazardous at a concentration that makes the product hazardous." },
    ] },
    { no: 16, title: "Other information", fields: [
      { k: "disclaimer", label: "Disclaimer", text: "The information is given in good faith, from the data available on the date of issue. It does not replace the user's own tests to confirm that the product is suitable for a given purpose. Safety information is reviewed regularly." },
    ] },
  ],
};

const clean = (s) => (s == null ? "" : String(s).trim());
const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "");

export function pctText(l) {
  if (l.pct_text) return l.pct_text;
  if (l.pct != null && l.pct !== "") return String(Number(l.pct));
  return "";
}

// what could be wrong with this sheet? shown to the preparer, never printed
export function reviewNotes({ product, lines, ingredients }) {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const notes = [];
  if (!lines.length) notes.push({ level: "red", text: "This product has no formula yet. Add its ingredients first." });
  const noPct = lines.filter((l) => !pctText(l));
  if (noPct.length) notes.push({ level: "amber", text: `No percentage for ${noPct.length} of ${lines.length} ingredients (${noPct.slice(0, 4).map((l) => l.label).join(", ")}${noPct.length > 4 ? "…" : ""}). Add them if the sheet should show them.` });
  const sum = lines.reduce((a, l) => a + (l.pct != null && l.pct !== "" ? Number(l.pct) : 0), 0);
  if (lines.length && noPct.length === 0 && Math.abs(sum - 100) > 1.5 && !lines.some((l) => /q\.?s/i.test(l.pct_text || ""))) notes.push({ level: "amber", text: `The percentages add up to ${sum.toFixed(2)}, not 100.` });
  const noCas = lines.filter((l) => !clean(l.cas) && !(l.ingredient_id && byId.get(l.ingredient_id)?.cas));
  if (noCas.length) notes.push({ level: "grey", text: `${noCas.length} ingredient(s) have no CAS number.` });
  const unlinked = lines.filter((l) => !l.ingredient_id);
  if (unlinked.length) notes.push({ level: "grey", text: `${unlinked.length} ingredient(s) are not linked to the ingredient library, so their supplier safety data is not used: ${unlinked.slice(0, 5).map((l) => l.label).join(", ")}${unlinked.length > 5 ? "…" : ""}.` });
  lines.forEach((l) => {
    const ing = l.ingredient_id ? byId.get(l.ingredient_id) : null;
    if (!ing) return;
    const h = ing.hazard?.h || [];
    if (h.length) notes.push({ level: "amber", text: `${l.label}${pctText(l) ? ` (${pctText(l)}%)` : ""} carries hazard statements in its supplier MSDS: ${h.join(", ")}. Check whether the concentration in this product makes the product hazardous.` });
    if (ing.limits) notes.push({ level: "grey", text: `${l.label}: ${ing.limits}` });
    if (ing.status !== "verified") notes.push({ level: "grey", text: `${l.label}: ingredient data is not verified yet.` });
  });
  if (!product.physchem?.ph) notes.push({ level: "grey", text: "pH is not entered for this product." });
  if (!product.physchem?.appearance) notes.push({ level: "grey", text: "Appearance is not entered for this product." });
  if (!product.licence_ref) notes.push({ level: "grey", text: "Manufacturing licence number is not entered for this product." });
  return notes;
}

// build the sheet. `template` is the saved template (falls back to the built-in one).
export function buildMsds({ product, lines, ingredients, firm, template, preparedBy, docNo, version = 1 }) {
  const tpl = template?.sections ? template : DEFAULT_TEMPLATE;
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const ph = product.physchem || {};
  const co = firm || { company: FIRM_NAMES[product.firm_id] || "", address: "" };
  const auto = {
    product: `${product.name}${product.category ? ` (${product.category})` : ""}`,
    company: [co.company, co.address, co.phone && `Tel: ${co.phone}`, co.email && `Email: ${co.email}`].filter(Boolean).join(", "),
    storage: product.storage || "",
    form: product.form || ph.state || "",
    appearance: ph.appearance || "", colour: ph.colour || "", odour: ph.odour || "", ph: ph.ph || "", boiling: ph.boiling || "",
    flash: ph.flash || "", density: ph.density || "", solubility: ph.solubility || "",
    licence: product.licence_ref || "",
  };
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(); due.setFullYear(due.getFullYear() + (tpl.validity_years || 3));
  const sections = tpl.sections.map((s) => {
    const items = s.fields.map((f) => ({ k: f.k, label: f.label, value: f.auto && clean(auto[f.auto]) ? auto[f.auto] : (f.text ?? "") }));
    const sec = { no: s.no, title: s.title, items };
    if (s.table === "composition") {
      sec.rows = lines.map((l) => {
        const ing = l.ingredient_id ? byId.get(l.ingredient_id) : null;
        return { label: l.label, inci: l.inci_name || ing?.inci_name || l.label, pct: pctText(l), cas: l.cas || ing?.cas || "", function: l.function || ing?.function || "" };
      });
    }
    return sec;
  });
  return {
    header: { title: "MATERIAL SAFETY DATA SHEET", product: product.name, company: co.company, address: co.address, firm_id: product.firm_id },
    meta: { doc_no: docNo || "", version, prepared_by: preparedBy || "", prepared_on: today, review_due: due.toISOString().slice(0, 10) },
    sections,
  };
}

// ── Word file ─────────────────────────────────────────────────────────────
export async function toDocx(msds, { approvedBy, approvedOn, status } = {}) {
  const d = await import("docx");
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType, BorderStyle, ShadingType, Header, Footer, PageNumber } = d;
  const border = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text, opts = {}) => new TableCell({ borders, width: { size: opts.w || 50, type: WidthType.PERCENTAGE }, shading: opts.head ? { type: ShadingType.CLEAR, fill: "E7EEF0" } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 }, children: [new Paragraph({ children: [new TextRun({ text: clean(text), bold: !!opts.head || !!opts.bold, size: 20 })] })] });
  const kids = [];
  kids.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: msds.header.company.toUpperCase(), bold: true, size: 28 })] }));
  if (msds.header.address) kids.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: msds.header.address, size: 18 })] }));
  kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 120 }, children: [new TextRun({ text: msds.header.title, bold: true, size: 30 })] }));
  const m = msds.meta;
  kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
    new TableRow({ children: [cell("Product", { head: true, w: 20 }), cell(msds.header.product, { w: 30, bold: true }), cell("Document no. / version", { head: true, w: 25 }), cell(`${m.doc_no || "-"} / v${m.version}`, { w: 25 })] }),
    new TableRow({ children: [cell("Date prepared", { head: true, w: 20 }), cell(fmtDate(m.prepared_on), { w: 30 }), cell("Prepared by", { head: true, w: 25 }), cell(m.prepared_by, { w: 25 })] }),
    new TableRow({ children: [cell("Review due", { head: true, w: 20 }), cell(fmtDate(m.review_due), { w: 30 }), cell("Approved by", { head: true, w: 25 }), cell(status === "approved" ? `${approvedBy || ""} ${fmtDate(approvedOn)}` : "Not yet approved", { w: 25 })] }),
  ] }));
  msds.sections.forEach((s) => {
    kids.push(new Paragraph({ spacing: { before: 240, after: 80 }, shading: { type: ShadingType.CLEAR, fill: "0F766E" }, children: [new TextRun({ text: ` SECTION ${s.no} - ${s.title.toUpperCase()}`, bold: true, color: "FFFFFF", size: 22 })] }));
    if (s.rows) {
      kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
        new TableRow({ children: [cell("Ingredient", { head: true, w: 28 }), cell("INCI name", { head: true, w: 28 }), cell("% w/w", { head: true, w: 12 }), cell("CAS no.", { head: true, w: 17 }), cell("Function", { head: true, w: 15 })] }),
        ...s.rows.map((r) => new TableRow({ children: [cell(r.label, { w: 28 }), cell(r.inci, { w: 28 }), cell(r.pct, { w: 12 }), cell(r.cas, { w: 17 }), cell(r.function, { w: 15 })] })),
      ] }));
    }
    s.items.filter((i) => clean(i.value)).forEach((i) => {
      kids.push(new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: `${i.label}: `, bold: true, size: 20 }), new TextRun({ text: clean(i.value), size: 20 })] }));
    });
  });
  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${msds.header.company} · MSDS ${msds.header.product} · Page `, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 })] })] }) },
      children: kids,
    }],
  });
  return Packer.toBlob(doc);
}

// split an approval's ingredient list ("Water, Propylene Glycol, Polysorbate 20 …") into lines
export function splitIngredientList(text) {
  return String(text || "").replace(/\s+/g, " ").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
}
