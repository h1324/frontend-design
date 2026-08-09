import type { Machine, ParsedWorkbook, RawSku } from './types';

/*
 * Dependency-free .xlsx reader, ported from the prototype's parseWorkbook.
 * Unzips with DecompressionStream('deflate-raw'), reads sharedStrings.xml + sheet XML.
 *
 * FIX vs prototype (Bug 1): the original detected the closing column with the regex
 * /closing|stock/, which matched "Opening Stock" (column D) before "Closing Stock"
 * (column F) — collapsing closing onto opening and corrupting every derived figure.
 * Here we prefer an explicit "closing" match and, only as a fallback, a "stock"
 * column that is NOT the opening column.
 */

type Rows = (string | undefined)[][];

async function unzip(blob: Blob): Promise<Record<string, string>> {
  const dec = new TextDecoder();
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file');
  const cdCount = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files: Record<string, { method: number; comp: Uint8Array }> = {};
  for (let i = 0; i < cdCount; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.slice(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    files[name] = { method, comp: buf.slice(dataStart, dataStart + compSize) };
    p += 46 + nameLen + extraLen + commentLen;
  }
  const out: Record<string, string> = {};
  for (const [name, f] of Object.entries(files)) {
    if (f.method === 0) {
      out[name] = dec.decode(f.comp);
    } else if (f.method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      // Copy into a fresh ArrayBuffer-backed view so the Blob typing is exact.
      const ab = await new Response(new Blob([new Uint8Array(f.comp)]).stream().pipeThrough(ds)).arrayBuffer();
      out[name] = dec.decode(new Uint8Array(ab));
    }
  }
  return out;
}

const unesc = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#10;/g, ' ').replace(/&apos;/g, "'").replace(/&quot;/g, '"');

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm: RegExpExecArray | null;
    let s = '';
    while ((tm = tre.exec(m[1]))) s += tm[1];
    out.push(unesc(s));
  }
  return out;
}

const colToIndex = (c: string): number => {
  let n = 0;
  for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function sheetRows(xml: string, ss: string[]): Rows {
  const rows: Rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const cells: (string | undefined)[] = [];
    // Match each cell whether self-closing (<c .../>) or with inner content
    // (<c ...>…</c>), then pull the value out of the inner. IMPORTANT: the value
    // must be extracted regardless of a preceding <f>…</f> (a formula) — cells
    // like <c ...><f/><v>156</v></c> are common (machine tabs use formulas), and
    // an earlier version skipped them, badly under-counting production.
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(rm[1]))) {
      const attrs = cm[1] || '';
      const inner = cm[2];
      const rMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      if (!rMatch) continue;
      const col = colToIndex(rMatch[1]);
      const t = /t="([^"]*)"/.exec(attrs)?.[1];
      let val: string | undefined;
      if (inner) {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const isMatch = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        if (vMatch) val = t === 's' ? ss[parseInt(vMatch[1])] : vMatch[1];
        else if (isMatch) val = isMatch[1];
      }
      if (val != null) val = unesc(String(val));
      cells[col] = val;
    }
    rows.push(cells);
  }
  return rows;
}

const num = (v: string | undefined): number => {
  if (v == null || v === '') return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};
/** Whole pieces on the way in (business rule: stock is counted in whole pieces). */
const piecesIn = (v: string | undefined): number => Math.round(num(v));

export async function parseWorkbook(blob: Blob): Promise<ParsedWorkbook> {
  const z = await unzip(blob);
  const ss = sharedStrings(z['xl/sharedStrings.xml']);
  const wb = z['xl/workbook.xml'] || '';

  const rl: Record<string, string> = {};
  {
    const re = /<Relationship [^>]*?Id="(rId\d+)"[^>]*?Target="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(z['xl/_rels/workbook.xml.rels'] || ''))) rl[m[1]] = m[2];
  }
  const sheets: { name: string; rid: string }[] = [];
  {
    const re = /<sheet [^>]*?name="([^"]*)"[^>]*?r:id="(rId\d+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(wb))) sheets.push({ name: unesc(m[1]), rid: m[2] });
  }
  const rowsOf = (s: { rid: string }): Rows => {
    let t = rl[s.rid];
    if (!t) return [];
    if (!t.startsWith('xl/')) t = 'xl/' + t.replace(/^\//, '');
    return sheetRows(z[t] || '', ss);
  };

  // ── Master SKU List ──────────────────────────────────────────────────────
  const skus: RawSku[] = [];
  let lines: string[] = [];
  const master =
    sheets.find((s) => /master sku/i.test(s.name)) || sheets.find((s) => /sku/i.test(s.name));
  if (master) {
    const rows = rowsOf(master);
    let hr = rows.findIndex((r) => r && r.some((c) => c && /opening/i.test(c)));
    if (hr < 0) hr = 1;
    const hdr = rows[hr] || [];
    const findIdx = (kw: string, exclude: number[] = []): number =>
      hdr.findIndex((c, i) => !!c && !exclude.includes(i) && new RegExp(kw, 'i').test(c));

    const ci = {
      line: findIdx('line|product'),
      model: findIdx('model|variant|item'),
      colour: findIdx('colou?r'),
      opening: findIdx('opening'),
      sold: findIdx('sold|dispatch'),
      // FIX: explicit "closing" first; fall back to a "stock" column that isn't opening.
      closing: (() => {
        const explicit = findIdx('closing');
        if (explicit >= 0) return explicit;
        const opening = findIdx('opening');
        return findIdx('stock', opening >= 0 ? [opening] : []);
      })(),
    };
    if (ci.line < 0) ci.line = 0;
    if (ci.model < 0) ci.model = 1;
    if (ci.colour < 0) ci.colour = 2;
    if (ci.opening < 0) ci.opening = 3;
    if (ci.sold < 0) ci.sold = 4;
    if (ci.closing < 0 || ci.closing === ci.opening) ci.closing = 5;

    let curLine = '';
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;
      let line = (r[ci.line] || '').trim();
      if (line) curLine = line;
      else line = curLine;
      const model = (r[ci.model] || '').trim();
      const colour = (r[ci.colour] || '').trim();
      if (!model && !colour) continue;
      skus.push({
        line, model, colour,
        opening: piecesIn(r[ci.opening]),
        sold: piecesIn(r[ci.sold]),
        closing: piecesIn(r[ci.closing]),
      });
    }
    lines = [...new Set(skus.map((s) => s.line).filter(Boolean))];
  }

  // ── Machine tabs (Fresh band only; Rejection columns are unreliable) ──────
  const machines: Machine[] = [];
  for (const s of sheets) {
    if (!/^M-?\d+$/i.test(s.name.trim())) continue;
    const rows = rowsOf(s);
    const band = rows[2] || [];
    const idxOf = (kw: string): number => band.findIndex((c) => c && new RegExp(kw, 'i').test(c));
    let freshStart = idxOf('fresh');
    if (freshStart < 0) freshStart = 4;
    const mixStart = idxOf('colour mix|mix');
    const rejStart = idxOf('reject');
    const freshEnd =
      mixStart > freshStart ? mixStart : rejStart > freshStart ? rejStart : band.length;
    let fresh = 0;
    let activeDays = 0;
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      let rf = 0;
      for (let c = freshStart; c < freshEnd; c++) rf += num(r[c]);
      fresh += rf;
      if (rf > 0) activeDays++;
    }
    machines.push({ name: s.name.trim().toUpperCase(), fresh: Math.round(fresh), activeDays });
  }
  machines.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return { skus, lines, machines, sheetNames: sheets.map((s) => s.name) };
}
