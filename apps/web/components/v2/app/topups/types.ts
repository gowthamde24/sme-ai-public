import type { PreviewResult, SettingsInput, TopupResult } from "@/lib/topups/types";

/** The moves of the top-up screens, bound to the workspace by the page (server actions: lib/topups/source.ts behind app/app/tenants/[tenantId]/topup-actions.ts). `simulate` is null outside test mode. */
export type TopupActions = {
  buy: (purchaseId: string, packCode: string, method: string) => Promise<TopupResult>;
  save: (input: SettingsInput) => Promise<TopupResult>;
  preview: (planId: string) => Promise<PreviewResult>;
  upgrade: (planId: string, method: string) => Promise<TopupResult>;
  simulate: ((percent: number) => Promise<TopupResult>) | null;
};

/** A plan the business could move up to (the name only: no price list is ever drawn). */
export type UpgradeTarget = { id: string; name: string };
