import type { TodayActions } from "@/components/v2/app/today/actions-types";
import type { Role } from "@/components/v2/app/today/types";

import { askFirstAction, dismissAskFirstAction } from "./ask-first-actions";
import { approveCallAction, approveMessageAction, callHandledAction, editMessageAction, enquiryDoneAction, offerVisitAction, priceAskAnsweredAction, rejectMessageAction, skipProspectAction } from "./today-actions";
import { cancelVisitAction, confirmVisitAction, moveVisitAction, slotsAction } from "./visits/visits-actions";

/** The decisions on the cards: server actions bound to this workspace (the browser never holds the token). One list for every way Today is drawn. */
export function todayActionsFor(tenantId: string, role: Role): TodayActions {
  return {
    approveMessage: approveMessageAction.bind(null, tenantId),
    rejectMessage: rejectMessageAction.bind(null, tenantId),
    editMessage: editMessageAction.bind(null, tenantId),
    approveCall: approveCallAction.bind(null, tenantId),
    offerVisit: offerVisitAction.bind(null, tenantId),
    callHandled: callHandledAction.bind(null, tenantId),
    priceAskAnswered: priceAskAnsweredAction.bind(null, tenantId),
    enquiryDone: enquiryDoneAction.bind(null, tenantId),
    visit: { confirm: confirmVisitAction.bind(null, tenantId), move: moveVisitAction.bind(null, tenantId), cancel: cancelVisitAction.bind(null, tenantId), slots: slotsAction.bind(null, tenantId) },
    // the Lead Finder's rows: Owner, Admin and Sales act on prospects (a Viewer is never shown them)
    askFirst: role === "owner" ? { ask: askFirstAction.bind(null, tenantId), dismiss: dismissAskFirstAction.bind(null, tenantId) } : null,
    prospect: role === "viewer" ? null : { skip: skipProspectAction.bind(null, tenantId) },
  };
}
