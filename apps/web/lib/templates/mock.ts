import { MOCK_BUSINESS, type Wire } from "@/lib/jobs/fixtures";

/**
 * THE FIXTURES of the own-message builder (JOBS=mock): what the API would send, in the WIRE shape proposed in contracts/template-builder-web-needs.md, run through the REAL parsers (lib/api/template-builder-parse.ts) by lib/api/template-builder.ts;
 * lib/api/template-builder.test.ts parses every fixture. Nothing here is sent or stored. The assistant's writing is a MOCK: a few closed intents found by plain words in the sentence (a blouse ready, an order on its way, a visit reminder, a festival offer);
 * a sentence it cannot place is "unclear". The blouse draft is written with the two slips the checks catch (a shouted word, the name first) so the demo shows the one-tap Fix: a real writer will slip less often.
 */
const SHOP = MOCK_BUSINESS;
const AREA = "Begum Bazaar";
const wireDraft = (language: "te" | "en", header: string, body: string, footer: string | null, buttons: string[]): Wire => ({ language, header, body, footer, buttons });
const wireWritten = (category: "utility" | "marketing", title: { en: string; te: string }, te: Wire, en: Wire): Wire => ({ category, title, drafts: [te, en] });

const INTENTS: { id: string; words: RegExp; wire: () => Wire }[] = [
  {
    id: "blouse_ready",
    words: /blouse|stitch|pick ?up|ready|రెడీ|బ్లౌజ్/i,
    wire: () =>
      wireWritten(
        "utility",
        { en: "Blouse ready for pickup", te: "Blouse రెడీ" },
        wireDraft("te", "మీ blouse రెడీ", `నమస్కారం {name} గారు, మీ blouse రెడీ అయింది. ${SHOP} షాప్‌లో రోజూ ఉదయం 10 నుంచి రాత్రి 8 లోపు pickup చేసుకోవచ్చు. ఎప్పుడు వస్తారో చెప్పండి.`, `${SHOP} · ${AREA}`, ["ఈ రోజే వస్తాను", "షాప్‌కి కాల్ చేయండి"]),
        wireDraft("en", "Your blouse is ready", `{name}, your blouse is READY for pickup at ${SHOP}. Collect it any day between 10 am and 8 pm. Tell us when you are coming.`, `${SHOP} · ${AREA}`, ["I will come today", "Call the shop"]),
      ),
  },
  {
    id: "out_for_delivery",
    words: /deliver|dispatch|courier|parcel|shipped|డెలివరీ|పార్సెల్/i,
    wire: () =>
      wireWritten(
        "utility",
        { en: "Order out for delivery", te: "Order డెలివరీకి బయలుదేరింది" },
        wireDraft("te", "మీ order వస్తోంది", `నమస్కారం {name} గారు, మీ order ఈ రోజు డెలివరీకి బయలుదేరింది. ఇంట్లో ఎవరైనా ఉంటారో చెప్పండి. ధన్యవాదాలు.`, `${SHOP} · ${AREA}`, ["ఉంటాను", "రేపు పంపండి"]),
        wireDraft("en", "Your order is on its way", `Hello {name}, your order is out for delivery today. Please tell us if someone will be at home. Thank you.`, `${SHOP} · ${AREA}`, ["I will be home", "Send tomorrow"]),
      ),
  },
  {
    id: "visit_reminder",
    words: /visit|appointment|remind|reminder|tomorrow|విజిట్|అపాయింట్/i,
    wire: () =>
      wireWritten(
        "utility",
        { en: "Visit reminder", te: "Visit రిమైండర్" },
        wireDraft("te", "రేపు మీ visit", `నమస్కారం {name} గారు, రేపు మీ visit కోసం ${SHOP} షాప్ ఎదురు చూస్తోంది. రావడం కుదరకపోతే చెప్పండి, వేరే సమయం చూద్దాం. ధన్యవాదాలు.`, `${SHOP} · ${AREA}`, ["వస్తాను", "సమయం మార్చండి"]),
        wireDraft("en", "Your visit tomorrow", `Hello {name}, ${SHOP} is waiting for your visit tomorrow. If you cannot come, tell us and we will find another time. Thank you.`, `${SHOP} · ${AREA}`, ["I will come", "Change the time"]),
      ),
  },
  {
    id: "festival_offer",
    words: /offer|festival|diwali|sale|discount|collection|ఆఫర్|పండుగ|దీపావళి/i,
    wire: () =>
      wireWritten(
        "marketing",
        { en: "Festival collection", te: "పండుగ collection" },
        wireDraft("te", "పండుగ collection వచ్చింది", `నమస్కారం {name} గారు, ${SHOP}లో పండుగ కోసం కొత్త collection వచ్చింది. రేపటి నుంచి షాప్‌లో చూడవచ్చు. ధన్యవాదాలు.`, "ఆపాలంటే STOP అని రిప్లై చేయండి", ["చూడాలి", "తరువాత"]),
        wireDraft("en", "Our festival collection is here", `Hello {name}, the new festival collection has arrived at ${SHOP}. You can see it in the shop from tomorrow. Thank you.`, "Reply STOP to opt out", ["Show me", "Later"]),
      ),
  },
];

/** What the mock assistant writes for a sentence: the wire answer (`{unclear: true}` when it cannot place it). With `previous` (the owner is changing a message by saying it) the new sentence is read the same way. */
export function wireDraftFor(text: string): Wire {
  const hit = INTENTS.find((i) => i.words.test(text));
  return hit ? hit.wire() : { unclear: true };
}

/** `GET .../own-templates` for the demo shop: one waiting, one approved, one sent back (the reasons the screen has words for). */
export const WIRE_OWN_MESSAGES: Wire = {
  items: [
    { id: "own-delivery-update", title: { en: "Delivery update", te: "Delivery అప్‌డేట్" }, category: "utility", status: "waiting", submitted_at: "2026-11-19T05:12:00Z", decided_at: null, reason: null },
    { id: "own-visit-reminder", title: { en: "Visit reminder", te: "Visit రిమైండర్" }, category: "utility", status: "approved", submitted_at: "2026-11-17T06:30:00Z", decided_at: "2026-11-17T08:05:00Z", reason: null },
    { id: "own-festival-offer", title: { en: "Festival offer", te: "పండుగ offer" }, category: "utility", status: "needs_change", submitted_at: "2026-11-18T05:00:00Z", decided_at: "2026-11-18T07:40:00Z", reason: { code: "price_or_offer", params: { word: "discount" } } },
  ],
};

/** A made-up message the mock "submits" (nothing is sent or stored): it comes back as Waiting, as WhatsApp would answer it. */
export const wireSubmitted = (id: string, title: { en: string; te: string | null }, category: string, nowIso: string): Wire => ({ id, title, category, status: "waiting", submitted_at: nowIso, decided_at: null, reason: null });
