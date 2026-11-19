/**
 * Meta's Embedded Signup in the browser (Customer Zero, "Connect with Facebook"): load Meta's JS SDK on demand, open its window with our configuration, and read the two answers: the short `code` from `FB.login` and the account and number from
 * the `WA_EMBEDDED_SIGNUP` window message. Only the card that needs it loads the script (the route-JS budget); the script comes from Meta's own address (our CSP lets a script our own nonced code adds, and allows Meta's frames and
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

/** The `FB.login` options of the owner's decision: Embedded Signup v4 with the app-coexistence feature type (a shop keeps its WhatsApp Business app number), an authorization code, our configuration. */
export function loginOptions(configId: string): Record<string, unknown> {
  return { config_id: configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" } };
}

let inited = false;
/** The SDK, loaded once (the script is added the first time it is asked for) and initialised with our app id. Rejects when the script cannot be loaded (blocked, offline). */
export function loadFacebookSdk(appId: string, version: string, doc: Document = document): Promise<FbSdk> {
  const win = doc.defaultView as Window;
  const ready = (): FbSdk => {
    const fb = win.FB as FbSdk;
    if (!inited) {
      fb.init({ appId, autoLogAppEvents: true, xfbml: false, version });
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

export type SignupMessage = { kind: "finish"; wabaId: string; phoneNumberId: string } | { kind: "cancel" } | { kind: "error"; reason: string };

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
    const waba = String(data.waba_id ?? "");
    const phone = String(data.phone_number_id ?? "");
    return ID.test(waba) && ID.test(phone) ? { kind: "finish", wabaId: waba, phoneNumberId: phone } : { kind: "error", reason: "" };
  }
  return null;
}
