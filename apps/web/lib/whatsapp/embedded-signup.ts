/**
 * Meta's Embedded Signup in the browser (Customer Zero, "Connect with Facebook"): load Meta's JS SDK on demand, open its window with our configuration, and read the two answers: the short `code` from `FB.login` and the account and number from
 * the `WA_EMBEDDED_SIGNUP` window message. This is NOT analytics: it is Meta's own sign-up window for connecting a WhatsApp Business account, loaded only when the Owner presses "Connect with Facebook" on the WhatsApp page (never on page view, never anywhere else), with app-event logging off. Only the card that needs it loads the script (the route-JS budget); the script comes from Meta's own address (our CSP lets a script our own nonced code adds, and allows Meta's frames and
 * connections only on the WhatsApp page). Nothing here holds a token or a secret: the code goes to our API, which checks it.
 */
export const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";
/** The origins Meta's window may post its message from; anything else is ignored. */
export const FB_ORIGINS: readonly string[] = ["https://www.facebook.com", "https://web.facebook.com"];

export type FbLoginResponse = { authResponse?: { code?: string } | null; status?: string };
export type FbSdk = {
  init: (o: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }) => void;
  login: (callback: (r: FbLoginResponse) => void, options: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

/** What an API before Embedded Signup v5 never said: version 4, the app-coexistence feature type (a shop keeps its WhatsApp Business app number). */
const V4_EXTRAS: Record<string, unknown> = { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" };

/**
 * The `FB.login` options: an authorization code, our configuration, and the `extras` the API made for this version of Embedded Signup (v5, 20 Oct 2026: `{ setup: {}, version: "v5" }`, coexistence on by default), passed to Meta as they are;
 * without them (an older API) the v4 ones.
 */
export function loginOptions(configId: string, extras: Record<string, unknown> | null = null): Record<string, unknown> {
  return { config_id: configId, response_type: "code", override_default_response_type: true, extras: extras ?? V4_EXTRAS };
}

let inited = false;
/** The SDK, loaded once (the script is added the first time it is asked for) and initialised with our app id. Rejects when the script cannot be loaded (blocked, offline). */
export function loadFacebookSdk(appId: string, version: string, doc: Document = document): Promise<FbSdk> {
  const win = doc.defaultView as Window;
  const ready = (): FbSdk => {
    const fb = win.FB as FbSdk;
    if (!inited) {
      fb.init({ appId, autoLogAppEvents: false, xfbml: false, version }); // no app-event logging: the SDK is here only to open Meta's WhatsApp signup
      inited = true;
    }
    return fb;
  };
  if (win.FB) return Promise.resolve(ready());
  return new Promise<FbSdk>((resolve, reject) => {
    win.fbAsyncInit = () => resolve(ready());
    const el = doc.createElement("script");
    el.src = SDK_URL;
    el.async = true;
    el.defer = true;
    el.crossOrigin = "anonymous";
    el.onerror = () => reject(new Error("sdk_blocked"));
    doc.head.appendChild(el);
  });
}
/** For the tests only: forget that the SDK was initialised. */
export function resetSdkForTests(): void {
  inited = false;
}

/**
 * `coexistence` = the number stays on the WhatsApp Business app: Meta's app-onboarding event (v4) or `is_on_biz_app: true` (v5, which then sends FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING, otherwise FINISH).
 * Version 4 names the account `waba_id`, version 5 `messaging_account_ids` (and may not name the number): whichever came is carried on.
 */
export type SignupMessage = { kind: "finish"; wabaId: string | null; messagingAccountIds: string[]; phoneNumberId: string | null; coexistence: boolean; isOnBizApp: boolean | null } | { kind: "cancel" } | { kind: "error"; reason: string };

const ID = /^[0-9]{5,30}$/;
/** A short, plain, single-line text from Meta (its own words about what went wrong), never longer than 160 characters and without control characters. */
export const plainReason = (v: unknown): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "");

/**
 * What a window message from Meta means: FINISH (a number was chosen; also the event of an app-onboarding signup) with the account and number ids, CANCEL (the person closed the window) or ERROR (Meta's reason). Anything from another origin, of another type, or
 * with ids of the wrong shape is not ours: null.
 */
export function readSignupMessage(e: { origin: string; data: unknown }): SignupMessage | null {
  if (!FB_ORIGINS.includes(e.origin)) return null;
  let d: unknown = e.data;
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      return null;
    }
  }
  if (typeof d !== "object" || d === null) return null;
  const m = d as { type?: unknown; event?: unknown; data?: unknown };
  if (m.type !== "WA_EMBEDDED_SIGNUP" || typeof m.event !== "string") return null;
  const data = typeof m.data === "object" && m.data !== null ? (m.data as Record<string, unknown>) : {};
  if (m.event === "CANCEL") return { kind: "cancel" };
  if (m.event === "ERROR") return { kind: "error", reason: plainReason(data.error_message) };
  if (m.event === "FINISH" || m.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
    const waba = data.waba_id === undefined || data.waba_id === null ? null : String(data.waba_id);
    const phone = data.phone_number_id === undefined || data.phone_number_id === null ? null : String(data.phone_number_id);
    const many = Array.isArray(data.messaging_account_ids) ? data.messaging_account_ids.map((x) => String(x)) : [];
    const onBiz = typeof data.is_on_biz_app === "boolean" ? data.is_on_biz_app : null;
    const named = (waba !== null && ID.test(waba)) || (many.length > 0 && many.length <= 5 && many.every((x) => ID.test(x)));
    if (!named || (waba !== null && !ID.test(waba)) || (phone !== null && !ID.test(phone))) return { kind: "error", reason: "" };
    return { kind: "finish", wabaId: waba, messagingAccountIds: many, phoneNumberId: phone, coexistence: m.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" || onBiz === true, isOnBizApp: onBiz };
  }
  return null;
}
