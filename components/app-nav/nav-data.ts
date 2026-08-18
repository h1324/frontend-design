// One source of navigation truth, shared by the sidebar (app shell) and the console launcher.
// Group accents follow the material flow, not decoration: green = make/sell value chain,
// indigo = materials in, amber = quality holds, slate = supporting/reference.

export interface NavItem {
  label: string;
  href: string;
  desc: string;
}
export interface NavGroup {
  title: string;
  accent: string;
  adminOnly?: boolean;
  items: NavItem[];
}

export const GREEN = "hsl(168 64% 33%)";
export const INDIGO = "hsl(224 60% 56%)";
export const AMBER = "hsl(33 92% 44%)";
export const SLATE = "hsl(202 14% 46%)";

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Masters",
    accent: SLATE,
    items: [
      { label: "Items", href: "/masters/items", desc: "Foam SKUs, grades, HSN & GST" },
      {
        label: "Customers",
        href: "/masters/customers",
        desc: "Buyers, ship-tos & credit",
      },
      {
        label: "Suppliers",
        href: "/masters/suppliers",
        desc: "Resin, butane, additives",
      },
      {
        label: "Production masters",
        href: "/masters/production",
        desc: "Machines, shifts, operators",
      },
    ],
  },
  {
    title: "Production",
    accent: GREEN,
    items: [
      { label: "Lots", href: "/production/lots", desc: "Extrusion runs & regrind blend" },
      {
        label: "Rolls",
        href: "/production/rolls",
        desc: "Every numbered unit of output",
      },
      { label: "Aging", href: "/production/aging", desc: "Curing → available queue" },
      {
        label: "Converting",
        href: "/converting",
        desc: "Lamination, slitting, genealogy",
      },
    ],
  },
  {
    title: "Stores & purchasing",
    accent: INDIGO,
    items: [
      { label: "Stores", href: "/stores/receipts", desc: "RM receipts & issues" },
      {
        label: "Purchase orders",
        href: "/purchasing/orders",
        desc: "Orders to suppliers",
      },
      {
        label: "Receiving (GRN)",
        href: "/purchasing/grn",
        desc: "Goods receipt & landed cost",
      },
    ],
  },
  {
    title: "Quality",
    accent: AMBER,
    items: [
      {
        label: "QC queue",
        href: "/qc/queue",
        desc: "Density, thickness, hold & release",
      },
    ],
  },
  {
    title: "Sales & dispatch",
    accent: GREEN,
    items: [
      {
        label: "Sales orders",
        href: "/sales/orders",
        desc: "Order, credit check, fulfil",
      },
      {
        label: "Quotations",
        href: "/sales/quotations",
        desc: "Quote, price contracts, win",
      },
      { label: "Field orders", href: "/m", desc: "Mobile capture for reps" },
      { label: "Dispatch", href: "/dispatch", desc: "Pick, invoice, e-way & IRN" },
      { label: "Receivables", href: "/receivables", desc: "Ageing & overdue exposure" },
    ],
  },
  {
    title: "Costing & analytics",
    accent: SLATE,
    items: [
      {
        label: "Valuation",
        href: "/costing/valuation",
        desc: "Moving-average landed cost",
      },
      { label: "Cost rates", href: "/costing/rates", desc: "Energy, labour, overhead" },
      { label: "Margin", href: "/costing/margin", desc: "Sale vs. cost by customer" },
      { label: "Dashboards", href: "/dashboards", desc: "OEE, yield, kWh/kg, AR" },
    ],
  },
  {
    title: "Integrations",
    accent: SLATE,
    items: [
      {
        label: "Tally sync",
        href: "/integrations/tally",
        desc: "Invoices out, receipts in",
      },
    ],
  },
  {
    title: "Administration",
    accent: SLATE,
    adminOnly: true,
    items: [{ label: "Users", href: "/admin/users", desc: "People, roles & access" }],
  },
];
