import type { InvitedRole, Member, MemberRole } from "@/lib/api/team";
import { whatsappShareLink } from "@/lib/whatsapp/share";

import type { Say } from "../words";

/** The pure rules of the team screen (job CC, screen 4); the API and the database decide again. */
export const DAYS = [3, 7, 14, 30] as const;
export const REASONS = ["no_longer_works_here", "access_no_longer_needed", "security_concern", "other"] as const;

/** The roles a person may invite: an Owner any, an Admin Sales and Viewer only. */
export function invitableRoles(myRole: string): readonly InvitedRole[] {
  return myRole === "owner" ? ["admin", "sales", "viewer"] : myRole === "admin" ? ["sales", "viewer"] : [];
}

/** The roles a person may change another member TO. An Owner: admin, sales, viewer. An Admin: sales and viewer, and only for a member who is sales or viewer. Nobody changes an Owner, or their own role. */
export function changeableTo(myRole: string, member: Pick<Member, "role" | "is_you">): readonly InvitedRole[] {
  if (member.is_you || member.role === "owner") return [];
  if (myRole === "owner") return ["admin", "sales", "viewer"];
  if (myRole === "admin" && (member.role === "sales" || member.role === "viewer")) return ["sales", "viewer"];
  return [];
}

/** May this person remove that member? An Owner anyone but an Owner; an Admin Sales and Viewer; anyone but an Owner may leave. */
export function canRemove(myRole: string, member: Pick<Member, "role" | "is_you">): boolean {
  if (member.is_you) return member.role !== "owner";
  if (member.role === "owner") return false;
  return myRole === "owner" || (myRole === "admin" && (member.role === "sales" || member.role === "viewer"));
}

export const roleWord = (role: MemberRole, t: Say): string => t(`team.role.${role}`);

/** The same mistakes the API refuses a label for, said before asking: a run of 7 digits or an "@" (a label must not carry a phone number or an address). */
export function labelProblem(label: string): boolean {
  return /@/.test(label) || /\d{7}/.test(label.replace(/[\s-]/g, "")) || label.trim().length > 60;
}

/** The closed codes of the team routes and the sentence for each. */
export const TEAM_CODES = ["too_many_invitations", "role_not_allowed", "own_role", "keep_owner", "invitation_not_pending", "invitation_invalid", "invitation_locked", "already_member"] as const;
export const teamSentence = (code: string, t: Say): string | null => ((TEAM_CODES as readonly string[]).includes(code) ? t(`team.err.${code}`) : null);

/** The message a person sends by hand with the code: the shop, the address that opens the join page with the code in its fragment, and the code itself for typing. */
export function shareText(t: Say, shop: string, url: string, code: string): string {
  return t("team.share.text", { shop, url, code });
}
export const whatsappShare = whatsappShareLink;
export const mailShare = (subject: string, text: string): string => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
