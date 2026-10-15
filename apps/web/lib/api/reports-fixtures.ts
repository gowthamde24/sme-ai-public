/** Synthetic construction reports as the API sends them (job CU). Nothing here is a real customer, product or amount. */
export const CATALOGUE_WEEKLY_JSON = { items: [{ code: "weekly.summary", title_key: "report.weekly.summary", window: "week", modules: ["reports"] }] };
export const CATALOGUE_CONSTRUCTION_JSON = {
  items: [
    ...CATALOGUE_WEEKLY_JSON.items,
    { code: "construction.quotes", title_key: "report.construction.quotes", window: "range", modules: ["reports", "materials"] },
    { code: "construction.revenue_by_product", title_key: "report.construction.revenue_by_product", window: "range", modules: ["reports", "materials", "orders"] },
    { code: "construction.trips_per_day", title_key: "report.construction.trips_per_day", window: "range", modules: ["reports", "deliveries"] },
    { code: "construction.dues_ageing", title_key: "report.construction.dues_ageing", window: "day", modules: ["reports", "dues", "companies"] },
    { code: "construction.top_customers", title_key: "report.construction.top_customers", window: "range", modules: ["reports", "materials", "orders", "companies"] },
  ],
};
export const CATALOGUE_EDUCATION_JSON = {
  items: [
    ...CATALOGUE_WEEKLY_JSON.items,
    { code: "education.collection", title_key: "report.education.collection", window: "range", modules: ["reports", "programmes", "fees"] },
    { code: "education.today", title_key: "report.education.today", window: "day", modules: ["reports", "programmes", "fees"] },
    { code: "education.pending", title_key: "report.education.pending", window: "day", modules: ["reports", "programmes", "fees"] },
    { code: "education.funnel", title_key: "report.education.funnel", window: "range", modules: ["reports", "programmes"] },
  ],
};
const head = (report: string, from: string, to: string) => ({ report, as_of: to, from, to });
export const QUOTES_REPORT_JSON = {
  ...head("construction.quotes", "2026-09-15", "2026-10-14"),
  kpis: [{ key: "quotes_made", value: 24, unit: "count" }, { key: "quotes_approved", value: 15, unit: "count" }, { key: "quotes_won", value: 9, unit: "count" }, { key: "win_rate_pct", value: 60, unit: "percent" }, { key: "approved_value_paise", value: 184500000, unit: "paise" }, { key: "won_value_paise", value: 96000000, unit: "paise" }],
  tables: [{ key: "by_status", columns: [{ key: "status", type: "text" }, { key: "quotes", type: "count" }, { key: "total_paise", type: "paise" }], rows: [["approved", 15, 184500000], ["draft", 7, 41000000], ["rejected", 2, 9000000]] }],
  series: [{ key: "quotes_by_day", points: [{ day: "2026-10-12", value: 3 }, { day: "2026-10-13", value: 5 }, { day: "2026-10-14", value: 2 }] }],
};
export const REVENUE_REPORT_JSON = {
  ...head("construction.revenue_by_product", "2026-09-15", "2026-10-14"),
  kpis: [{ key: "orders", value: 9, unit: "count" }, { key: "order_value_paise", value: 96000000, unit: "paise" }, { key: "material_paise", value: 81000000, unit: "paise" }],
  tables: [{ key: "by_product", columns: [{ key: "product", type: "text" }, { key: "unit", type: "text" }, { key: "quantity", type: "count" }, { key: "revenue_paise", type: "paise" }], rows: [["Paver block 200x100 (synthetic)", "sq_ft", 4200.5, 52000000], ["Kerb stone (synthetic)", "piece", 600, 29000000]] }],
  series: [],
};
export const TRIPS_REPORT_JSON = {
  ...head("construction.trips_per_day", "2026-09-15", "2026-10-14"),
  kpis: [{ key: "trips", value: 31, unit: "count" }, { key: "delivered", value: 26, unit: "count" }, { key: "problems", value: 2, unit: "count" }, { key: "cancelled", value: 3, unit: "count" }, { key: "delivered_pct", value: 92.9, unit: "percent" }],
  tables: [{ key: "by_status", columns: [{ key: "status", type: "text" }, { key: "trips", type: "count" }], rows: [["delivered", 26], ["problem", 2], ["cancelled", 3]] }],
  series: [{ key: "trips_by_day", points: [{ day: "2026-10-13", value: 2 }, { day: "2026-10-14", value: 3 }] }, { key: "delivered_by_day", points: [{ day: "2026-10-13", value: 2 }] }],
};
export const DUES_REPORT_JSON = {
  ...head("construction.dues_ageing", "2026-10-14", "2026-10-14"),
  kpis: [{ key: "outstanding_paise", value: 130000000, unit: "paise" }, { key: "overdue_paise", value: 50000000, unit: "paise" }, { key: "customers_owing", value: 6, unit: "count" }, { key: "overdue_pct", value: 38.5, unit: "percent" }],
  tables: [
    { key: "ageing", columns: [{ key: "bucket", type: "text" }, { key: "paise", type: "paise" }], rows: [["not_due", 80000000], ["d1_30", 30000000], ["d31_60", 20000000], ["d61_90", 0], ["d90_plus", 0]] },
    { key: "top_debtors", columns: [{ key: "customer", type: "text" }, { key: "outstanding_paise", type: "paise" }, { key: "overdue_paise", type: "paise" }], rows: [["Sri Rama Builders (synthetic)", 50000000, 30000000], ["Lakshmi Constructions (synthetic)", 45000000, 0]] },
  ],
  series: [],
};
export const TOP_CUSTOMERS_REPORT_JSON = {
  ...head("construction.top_customers", "2026-09-15", "2026-10-14"),
  kpis: [{ key: "customers", value: 7, unit: "count" }, { key: "orders", value: 9, unit: "count" }, { key: "order_value_paise", value: 96000000, unit: "paise" }],
  tables: [{ key: "top_customers", columns: [{ key: "customer", type: "text" }, { key: "orders", type: "count" }, { key: "revenue_paise", type: "paise" }], rows: [["Sri Rama Builders (synthetic)", 4, 52000000]] }],
  series: [],
};
