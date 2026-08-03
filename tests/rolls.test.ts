import { describe, it, expect } from "vitest";
import { formatRollNumber } from "../lib/doc-number.js";
import { compactFinancialYear } from "../lib/financial-year.js";
import {
  buildLabelModel,
  labelFieldLines,
  renderLabelText,
  renderLabelPdf,
  type LabelSource,
} from "../lib/rolls.js";

const src: LabelSource = {
  rollNo: "R2627-000123",
  lotNo: "LOT/2026-27/000045",
  itemCode: "EPE-3-25",
  itemName: "EPE 3mm 25kg/m³ roll",
  qtyKgActual: "45.8",
  qtyM2: "120",
  length_m: "100",
  width_m: "1.2",
  thicknessMm: "3",
  densityKgM3: "25",
  productionDate: new Date("2026-08-03T04:00:00.000Z"), // 09:30 IST, still 3 Aug
  agingReadyDate: new Date("2026-08-06T04:00:00.000Z"),
};

describe("roll number format (pure)", () => {
  it("compacts the FY and zero-pads the sequence: R<compactFY>-000123", () => {
    expect(compactFinancialYear("2026-27")).toBe("2627");
    expect(formatRollNumber("2026-27", 123)).toBe("R2627-000123");
    expect(formatRollNumber("2025-26", 1)).toBe("R2526-000001");
  });
});

describe("label model (pure)", () => {
  it("carries every required field; GSM is derived (thickness × density)", () => {
    const m = buildLabelModel(src);
    expect(m.rollNo).toBe("R2627-000123");
    expect(m.lotNo).toBe("LOT/2026-27/000045");
    expect(m.sku).toBe("EPE-3-25");
    expect(m.netWeightKg).toBe("45.8");
    expect(m.lengthM).toBe("100");
    expect(m.widthM).toBe("1.2");
    expect(m.thicknessMm).toBe("3");
    expect(m.densityKgM3).toBe("25");
    expect(m.gsm).toBe("75"); // 3 × 25
    expect(m.productionDate).toBe("03/08/2026"); // DD/MM/YYYY, IST
    expect(m.agingReadyDate).toBe("06/08/2026");
  });

  it("shows an em dash for a missing lot or aging date", () => {
    const m = buildLabelModel({ ...src, lotNo: null, agingReadyDate: null });
    expect(m.lotNo).toBe("—");
    expect(m.agingReadyDate).toBe("—");
  });
});

describe("label rendering (pure)", () => {
  it("text label contains the number, SKU, weight, dimensions, density and dates — no barcode", () => {
    const text = renderLabelText(buildLabelModel(src));
    expect(text).toContain("R2627-000123");
    expect(text).toContain("EPE-3-25");
    expect(text).toContain("45.8 kg");
    expect(text).toContain("100 m x 1.2 m x 3 mm");
    expect(text).toContain("25 kg/m3");
    expect(text).toContain("Produced: 03/08/2026");
    expect(text).toContain("Aging-ready: 06/08/2026");
    expect(text.toLowerCase()).not.toContain("barcode");
    // Nine labelled field lines below the heading + number.
    expect(labelFieldLines(buildLabelModel(src))).toHaveLength(9);
  });

  it("PDF is a valid single-page document embedding the roll number", () => {
    const bytes = renderLabelPdf(buildLabelModel(src));
    const s = Buffer.from(bytes).toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("R2627-000123");
    expect(s).toContain("/Type/Page");
    // A single Contents stream whose declared Length matches its bytes.
    const declared = Number(/\/Length (\d+)>>\nstream\n/.exec(s)?.[1]);
    const body = s.slice(
      s.indexOf("stream\n") + "stream\n".length,
      s.indexOf("\nendstream"),
    );
    expect(Buffer.byteLength(body, "latin1")).toBe(declared);
  });
});
