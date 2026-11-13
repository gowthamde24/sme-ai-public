import { connectionState, getWhatsappAccount, type ConnectionState } from "@/lib/api/whatsapp";
import { getBusinessProfile } from "@/lib/api/gstin";
import { listSources } from "@/lib/api/lead-sources";
import { settle } from "@/lib/api/part";
import { getTeam, type MemberRole } from "@/lib/api/team";
import { getWorkspaceProfile } from "@/lib/api/workspace";
import { getVisitSettings, type StoreSettings } from "@/lib/api/visits";
import type { DevKey, Usage } from "@/lib/api/developer";
import { readDeveloper } from "@/lib/developer/source";
import { readPhone } from "@/lib/phone-number/source";
import type { PhoneState } from "@/lib/phone-number/types";

/**
 * What the Settings overview of design system v6 shows (owner 13 Nov 2026), read from the readers the old tabs already use. Each part stands on its own: one that cannot be read is null and its card says "Not set yet" (never an invented value). The connections are
 * read for the Owner and Admin only. A rejected session is passed on (settle throws it). No secret is read here: the WhatsApp number's display phone, a count of live lead sources and the business number's state are all the page gets.
 */
export type SettingsV6Data = {
  business: { name: string; city: string | null; phone: string | null; languages: string[]; logoUrl: string | null } | null;
  gstin: string | null | undefined;
  team: { name: string | null; role: MemberRole; you: boolean }[] | null;
  whatsapp: { state: ConnectionState; phone: string | null } | null;
  sources: { active: number } | null;
  phone: { state: PhoneState; number: string | null } | null;
  /** The week of opening hours (the visits settings; Owner and Admin read them); null = not read. */
  hours: StoreSettings | null;
  /** The test keys card: null = DEVELOPER_KEYS_SCREENS is off (or not an Owner or Admin); `keys` null = the keys could not be read. */
  developer: { keys: DevKey[] | null; usage: Usage | null; mock: boolean } | null;
};

export async function readSettingsV6(token: string, tenantId: string, admin: boolean): Promise<SettingsV6Data> {
  const [profile, gst, team, wa, sources, phone, hours, developer] = await Promise.all([
    settle(() => getWorkspaceProfile(token, tenantId)),
    settle(() => getBusinessProfile(token, tenantId)),
    settle(() => getTeam(token, tenantId)),
    admin ? settle(() => getWhatsappAccount(token, tenantId)) : null,
    admin ? settle(() => listSources(token, tenantId)) : null,
    admin ? readPhone() : null,
    admin ? settle(() => getVisitSettings(token, tenantId)) : null,
    admin ? readDeveloper(token, tenantId) : null,
  ]);
  return {
    business: profile.ok ? { name: profile.data.name, city: profile.data.city, phone: profile.data.phone, languages: profile.data.languages, logoUrl: profile.data.logoUrl } : null,
    gstin: gst.ok ? gst.data.gstin : undefined,
    team: team.ok ? team.data.members.map((m) => ({ name: m.display_name, role: m.role, you: m.is_you })) : null,
    whatsapp: wa?.ok ? { state: connectionState(wa.data).state, phone: wa.data.configured ? wa.data.display_phone : null } : null,
    sources: sources?.ok ? { active: sources.data.filter((s) => s.status === "active").length } : null,
    phone: phone?.mode === "ok" ? { state: phone.data.state, number: phone.data.number } : null,
    hours: hours?.ok ? hours.data : null,
    developer: developer?.mode === "ok" ? { keys: developer.keys, usage: developer.usage, mock: developer.mock } : null,
  };
}
