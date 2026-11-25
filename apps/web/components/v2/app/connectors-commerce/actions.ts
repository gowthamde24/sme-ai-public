import type { CalendarChange, CalendarSaved, Calendar, Channel, ChannelInput, ChannelTest, FormTemplate, Ok, Preview, ShopCardData, ShopChange, ShopConnection } from "@/lib/api/commerce-notify";

/**
 * What the cards can do: server actions bound to the tenant (see `bindActions`, and the mounting recipe in docs/contracts/commerce-notify.md section E). Every answer is `{ ok: true, ... }` or a closed `Fail` word; a key typed into a
 * card is sent in one call and is never kept, logged or returned. The review sample passes `readOnly` and these are never called.
 */
export type CommerceActions = {
  connectShopify: (i: { id: string; shop: string; clientSecret: string; accessToken?: string; clientId?: string }) => Promise<Ok<{ card: ShopCardData }>>;
  connectWoo: (i: { id: string; site: string; key: string; secret: string }) => Promise<Ok<{ card: ShopCardData }>>;
  changeShop: (id: string, patch: ShopChange) => Promise<Ok<{ connection: ShopConnection }>>;
  testShop: (id: string) => Promise<Ok<{ connection: ShopConnection }>>;
  disconnectShop: (id: string) => Promise<Ok<unknown>>;
  previewCatalogue: (id: string, listId: string) => Promise<Ok<{ preview: Preview }>>;
  saveCatalogue: (id: string, listId: string, rows: Preview["rows"]) => Promise<Ok<{ created: number; updated: number }>>;
  putChannel: (kind: string, input: ChannelInput) => Promise<Ok<{ channel: Channel }>>;
  testChannel: (kind: string) => Promise<Ok<{ result: ChannelTest }>>;
  disconnectChannel: (kind: string) => Promise<Ok<unknown>>;
  connectCalendly: (i: { accessToken: string; bookingLink?: string }) => Promise<Ok<{ saved: CalendarSaved }>>;
  connectCalcom: (i: { bookingLink?: string; label?: string }) => Promise<Ok<{ saved: CalendarSaved }>>;
  changeCalendar: (kind: string, patch: CalendarChange) => Promise<Ok<{ calendar: Calendar }>>;
  disconnectCalendar: (kind: string) => Promise<Ok<unknown>>;
  startOutlook: () => Promise<Ok<{ url: string }>>;
  formTemplate: (id: string) => Promise<Ok<{ template: FormTemplate }>>;
};

/** The server actions as the "use server" file exports them (`commerce-actions.ts`): the name of each move with `Action` after it, and the tenant id first. */
export type ServerActions = { [K in keyof CommerceActions as `${K}Action`]: (tenantId: string, ...args: Parameters<CommerceActions[K]>) => ReturnType<CommerceActions[K]> };

/** Binds every server action to the tenant: the page passes the module namespace (`import * as moves from ".../commerce-actions"`) and its tenant id. */
export function bindActions(tenantId: string, m: ServerActions): CommerceActions {
  return {
    connectShopify: m.connectShopifyAction.bind(null, tenantId),
    connectWoo: m.connectWooAction.bind(null, tenantId),
    changeShop: m.changeShopAction.bind(null, tenantId),
    testShop: m.testShopAction.bind(null, tenantId),
    disconnectShop: m.disconnectShopAction.bind(null, tenantId),
    previewCatalogue: m.previewCatalogueAction.bind(null, tenantId),
    saveCatalogue: m.saveCatalogueAction.bind(null, tenantId),
    putChannel: m.putChannelAction.bind(null, tenantId),
    testChannel: m.testChannelAction.bind(null, tenantId),
    disconnectChannel: m.disconnectChannelAction.bind(null, tenantId),
    connectCalendly: m.connectCalendlyAction.bind(null, tenantId),
    connectCalcom: m.connectCalcomAction.bind(null, tenantId),
    changeCalendar: m.changeCalendarAction.bind(null, tenantId),
    disconnectCalendar: m.disconnectCalendarAction.bind(null, tenantId),
    startOutlook: m.startOutlookAction.bind(null, tenantId),
    formTemplate: m.formTemplateAction.bind(null, tenantId),
  };
}
