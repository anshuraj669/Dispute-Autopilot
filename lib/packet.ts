// Builds the evidence packet PDF that goes to PayPal with a FIGHT decision:
// the statement, each piece of evidence with the facts it cites, the case
// facts, the conversation, and an appendix of source records with fetch times
// and SHA-256 fingerprints. Everything comes from the case file, fresh.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { buildCaseFile } from "./casefile";
import { COLLECTABLE, type CollectKey } from "./evidence";
import { getSettings } from "./settings";
import { getCase } from "./store";
import { humanStatus } from "./format";

const PAGE = { w: 612, h: 792, margin: 54 };
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.36, 0.39, 0.47);
const BRAND = rgb(0, 0.19, 0.53);
const RULE = rgb(0.88, 0.9, 0.94);

// Standard PDF fonts only cover WinAnsi; swap or drop anything else.
const SWAPS: Record<string, string> = { "−": "-", "→": "->", "✓": "v", "✗": "x", " ": " ", " ": " " };
const clean = (t: string) =>
  t
    .replace(/[−→✓✗  ]/g, (c) => SWAPS[c])
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ‘’“”–—…•€]/g, "?");

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private footer: string) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.y = PAGE.h - PAGE.margin;
    const n = this.doc.getPageCount();
    this.page.drawText(clean(`${this.footer}  ·  page ${n}`), { x: PAGE.margin, y: 28, size: 8, font: this.font, color: MUTED });
  }

  ensure(height: number) {
    if (this.y - height < PAGE.margin) this.newPage();
  }

  lines(text: string, size: number, font: PDFFont, width: number): string[] {
    const out: string[] = [];
    for (const para of clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }

  text(t: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = PAGE.margin + (opts.indent ?? 0);
    for (const line of this.lines(t, size, font, PAGE.w - PAGE.margin - x)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size + 4;
    }
    this.y -= opts.gap ?? 2;
  }

  heading(t: string) {
    this.ensure(40);
    this.y -= 12;
    this.page.drawText(clean(t.toUpperCase()), { x: PAGE.margin, y: this.y - 10, size: 9.5, font: this.bold, color: BRAND });
    this.y -= 16;
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y }, end: { x: PAGE.w - PAGE.margin, y: this.y }, thickness: 0.7, color: RULE });
    this.y -= 8;
  }

  facts(rows: [string, string | null | undefined][]) {
    for (const [k, v] of rows) {
      if (!v) continue;
      const size = 10;
      const valueLines = this.lines(v, size, this.font, PAGE.w - PAGE.margin * 2 - 140);
      this.ensure(valueLines.length * (size + 4));
      this.page.drawText(clean(k), { x: PAGE.margin, y: this.y - size, size, font: this.bold, color: MUTED });
      for (const line of valueLines) {
        this.page.drawText(line, { x: PAGE.margin + 140, y: this.y - size, size, font: this.font, color: INK });
        this.y -= size + 4;
      }
    }
    this.y -= 2;
  }
}

const date = (iso?: string | null) => (iso ? new Date(iso).toUTCString().replace(" GMT", " UTC") : null);

export async function buildEvidencePacket(disputeId: string): Promise<{ name: string; data: Uint8Array }> {
  const [cf, record, settings] = await Promise.all([buildCaseFile(disputeId), getCase(disputeId), getSettings()]);
  const factIds = new Set(cf.facts.map((f) => f.id));

  const doc = await PDFDocument.create();
  doc.setTitle(`Evidence packet - dispute ${disputeId}`);
  doc.setAuthor(settings.merchantName);
  doc.setCreator("Dispute Autopilot");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, `${settings.merchantName} · evidence for PayPal dispute ${disputeId}`);

  w.text("Evidence packet", { size: 22, bold: true, gap: 4 });
  w.text(`${settings.merchantName} · PayPal dispute ${disputeId}`, { size: 11, color: MUTED });
  w.text(`Prepared ${date(cf.builtAt)}. Every statement below cites the source record it comes from; the records are listed with their SHA-256 fingerprints at the end.`, { size: 9, color: MUTED, gap: 8 });

  const decision = record?.decision;
  if (decision?.seller_statement) {
    w.heading("Seller statement");
    w.text(decision.seller_statement, { size: 10.5 });
  }

  if (decision?.evidence?.length || cf.collected.length) {
    w.heading("Evidence");
    for (const e of decision?.evidence ?? []) {
      w.text(humanStatus(e.evidence_type), { bold: true, gap: 0 });
      w.text(e.description, { indent: 8, gap: 0 });
      const cited = (e.sources ?? []).filter((id) => factIds.has(id));
      w.text(`Sources: ${cited.length ? cited.join(", ") : "none"}`, { size: 8.5, indent: 8, color: MUTED, gap: 6 });
    }
    for (const c of cf.collected) {
      w.text(`Supplied by the merchant: ${COLLECTABLE[c.key as CollectKey]?.label ?? c.key}`, { bold: true, gap: 0 });
      w.text(c.note || "(no note)", { indent: 8, gap: 0 });
      w.text(`${c.file ? `Attached file ${c.file.name}. ` : ""}Added ${date(c.at)}. Source: merchant.${c.key}`, { size: 8.5, indent: 8, color: MUTED, gap: 6 });
    }
  }

  w.heading("Case facts");
  const groups: [string, (id: string) => boolean][] = [
    ["Dispute", (id) => id.startsWith("dispute.")],
    ["Payment", (id) => id.startsWith("payment.")],
    ["Order", (id) => id.startsWith("order.")],
    ["Shipping and delivery", (id) => id.startsWith("tracker.") || id.startsWith("carrier.")],
    ["History and policy", (id) => id.startsWith("history.") || id.startsWith("policy.")],
  ];
  for (const [title, match] of groups) {
    const rows = cf.facts.filter((f) => match(f.id));
    if (!rows.length) continue;
    w.text(title, { bold: true, size: 10, gap: 2 });
    w.facts(rows.map((f) => [f.label, `${f.value}${f.at ? ` (${date(f.at)})` : ""}  [${f.id}]`]));
  }
  for (const t of cf.tracking) {
    for (const h of (t.history ?? []).slice(0, 12)) {
      w.text(`${date(h.at) ?? ""}  ${h.status}${h.location ? ` · ${h.location}` : ""}${h.details ? ` · ${h.details}` : ""}`, { size: 9, indent: 8, color: MUTED });
    }
  }
  if (!cf.trackers.length) w.text("No shipment tracking is recorded on this order.", { color: MUTED });

  if (cf.messages.length) {
    w.heading("Messages with the buyer");
    for (const m of cf.messages) {
      w.text(`${m.by === "SELLER" ? "Seller" : "Buyer"} · ${date(m.at) ?? ""}  [${m.fact}]`, { size: 8.5, bold: true, color: MUTED, gap: 0 });
      w.text(m.content, { indent: 8, gap: 6 });
    }
  }

  w.heading("Source records");
  w.text("Fetched by Dispute Autopilot when this packet was built. A fingerprint changes if the record changes.", { size: 9, color: MUTED });
  for (const src of cf.sources) {
    w.text(`${src.label}  [${src.id}]`, { bold: true, size: 9.5, gap: 0 });
    w.text(`${src.ref} · fetched ${date(src.fetchedAt)}`, { size: 8.5, indent: 8, color: MUTED, gap: 0 });
    w.text(`SHA-256 ${src.sha256}`, { size: 7.5, indent: 8, color: MUTED, gap: 5 });
  }

  return { name: `evidence-${disputeId}.pdf`, data: await doc.save() };
}
