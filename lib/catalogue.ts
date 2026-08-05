// lib/catalogue.ts — REPRESENTATIVE launch catalogue for a greenfield EPE line.
//
// These are *planned* items using industry-standard EPE values, not real production data.
// They exist so the system is populated for testing and pre-commissioning sign-off, and
// so the edge cases the brief calls out (0.5 mm ultra-thin, multi-layer laminate,
// odd-width special) are exercised. REPLACE with your actual SKUs, grades, LDPE grade
// names and HSN codes via the item master before go-live. HSN values below are common
// placeholders — confirm each with your CA.

import type { ItemInput } from "./items.js";

const HSN_EPE_SHEET = "39211900"; // cellular plastic sheets — confirm with CA
const HSN_LDPE = "39011010"; // LDPE, primary form
const HSN_BUTANE = "27111300"; // butanes, liquefied
const HSN_TALC = "25262000"; // talc, crushed/powdered
const GST_EPE_SHEET = "18"; // EPE foam sheets, Chapter 39 — confirm the rate with your CA

export const LAUNCH_CATALOGUE: ItemInput[] = [
  // --- finished goods: EPE foam rolls (mattress wrap + protective packaging) ----------
  {
    code: "FG-EPE22-2.0-1200",
    name: "EPE foam roll 22 kg/m³ · 2.0 mm · 1200 mm",
    type: "FINISHED_GOOD",
    uomBase: "M2",
    hsnCode: HSN_EPE_SHEET,
    gstRatePct: GST_EPE_SHEET,
    grade: "EPE-22",
    thickness_mm: "2.0",
    width_mm: "1200",
    density_kg_m3: "22",
    colour: "Natural White",
    layerCount: 1,
    surfaceTreatment: "PLAIN",
  },
  {
    code: "FG-EPE25-3.0-1500",
    name: "EPE foam roll 25 kg/m³ · 3.0 mm · 1500 mm",
    type: "FINISHED_GOOD",
    uomBase: "M2",
    hsnCode: HSN_EPE_SHEET,
    gstRatePct: GST_EPE_SHEET,
    grade: "EPE-25",
    thickness_mm: "3.0",
    width_mm: "1500",
    density_kg_m3: "25",
    colour: "Natural White",
    layerCount: 1,
    surfaceTreatment: "PLAIN",
  },
  {
    code: "FG-EPE18-1.0-1000",
    name: "EPE foam roll 18 kg/m³ · 1.0 mm · 1000 mm",
    type: "FINISHED_GOOD",
    uomBase: "M2",
    hsnCode: HSN_EPE_SHEET,
    gstRatePct: GST_EPE_SHEET,
    grade: "EPE-18",
    thickness_mm: "1.0",
    width_mm: "1000",
    density_kg_m3: "18",
    colour: "Natural White",
    layerCount: 1,
    surfaceTreatment: "PLAIN",
  },
  // edge case: 0.5 mm ultra-thin
  {
    code: "FG-EPE25-0.5-1000",
    name: "EPE foam roll 25 kg/m³ · 0.5 mm ultra-thin · 1000 mm",
    type: "FINISHED_GOOD",
    uomBase: "M2",
    hsnCode: HSN_EPE_SHEET,
    gstRatePct: GST_EPE_SHEET,
    grade: "EPE-25",
    thickness_mm: "0.5",
    width_mm: "1000",
    density_kg_m3: "25",
    colour: "Natural White",
    layerCount: 1,
    surfaceTreatment: "PLAIN",
  },
  // edge case: 8-layer laminate
  {
    code: "FG-LAM28-40-1200",
    name: "Laminated EPE block 28 kg/m³ · 40 mm · 8-layer · 1200 mm",
    type: "FINISHED_GOOD",
    uomBase: "M2",
    hsnCode: HSN_EPE_SHEET,
    gstRatePct: GST_EPE_SHEET,
    grade: "EPE-LAM-28",
    thickness_mm: "40",
    width_mm: "1200",
    density_kg_m3: "28",
    colour: "Natural White",
    layerCount: 8,
    surfaceTreatment: "LAMINATED",
  },
  // edge case: odd-width customer special
  {
    code: "FG-EPE22-2.0-1350",
    name: "EPE foam roll 22 kg/m³ · 2.0 mm · 1350 mm (customer special)",
    type: "FINISHED_GOOD",
    uomBase: "M2",
    hsnCode: HSN_EPE_SHEET,
    gstRatePct: GST_EPE_SHEET,
    grade: "EPE-22",
    thickness_mm: "2.0",
    width_mm: "1350",
    density_kg_m3: "22",
    colour: "Natural White",
    layerCount: 1,
    surfaceTreatment: "PLAIN",
  },
  // anti-static variant (electronics packaging)
  {
    code: "FG-EPE25AS-2.0-1200",
    name: "Anti-static EPE foam roll 25 kg/m³ · 2.0 mm · 1200 mm",
    type: "FINISHED_GOOD",
    uomBase: "M2",
    hsnCode: HSN_EPE_SHEET,
    gstRatePct: GST_EPE_SHEET,
    grade: "EPE-25-AS",
    thickness_mm: "2.0",
    width_mm: "1200",
    density_kg_m3: "25",
    colour: "Pink",
    layerCount: 1,
    surfaceTreatment: "ANTI_STATIC",
  },

  // --- raw materials -------------------------------------------------------------------
  {
    code: "RM-LDPE-FILM",
    name: "LDPE resin — film grade (MFI ~2)",
    type: "RAW_MATERIAL",
    uomBase: "KG",
    hsnCode: HSN_LDPE,
    reorderLevel: "2000",
  },
  {
    code: "RM-LDPE-EXT",
    name: "LDPE resin — extrusion grade",
    type: "RAW_MATERIAL",
    uomBase: "KG",
    hsnCode: HSN_LDPE,
    reorderLevel: "2000",
  },
  {
    code: "RM-BUTANE",
    name: "Butane — blowing agent",
    type: "RAW_MATERIAL",
    uomBase: "KG",
    hsnCode: HSN_BUTANE,
    reorderLevel: "500",
  },
  {
    code: "RM-TALC",
    name: "Talc — nucleating agent",
    type: "RAW_MATERIAL",
    uomBase: "KG",
    hsnCode: HSN_TALC,
    reorderLevel: "300",
  },
  {
    code: "RM-GMS",
    name: "GMS — glycerol monostearate (anti-static / nucleating)",
    type: "RAW_MATERIAL",
    uomBase: "KG",
    reorderLevel: "100",
  },
  {
    code: "RM-MB-WHITE",
    name: "Masterbatch — white",
    type: "RAW_MATERIAL",
    uomBase: "KG",
    reorderLevel: "200",
  },

  // --- consumables & packing ----------------------------------------------------------
  {
    code: "PK-STRETCH",
    name: "Stretch wrap film",
    type: "PACKING",
    uomBase: "KG",
    reorderLevel: "50",
  },
  {
    code: "PK-CORE-3IN",
    name: "Paper winding core — 3 inch",
    type: "PACKING",
    uomBase: "NOS",
    reorderLevel: "200",
  },
  {
    code: "CN-BLADE",
    name: "Slitter blade",
    type: "CONSUMABLE",
    uomBase: "NOS",
    reorderLevel: "20",
  },
];
