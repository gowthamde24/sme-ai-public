import { getChannels } from "@/lib/api/employees";
import { ApiAuthError } from "@/lib/api/client";
import type { Channels } from "@/lib/employees/types";
import { employeeScreens } from "@/lib/screens/flag";

/**
 * WhatsApp is OPTIONAL (owner rule, 26 Nov 2026): a responsibility an AI employee has only when the owner ticks it. A page that would mention WhatsApp asks `whatsappOn` first. SERVER ONLY.
 * Safe by default: with EMPLOYEES off, or when the channels cannot be read, WhatsApp counts as ON, so nothing a business already uses ever disappears because of a failed read.
 */
export async function readChannels(token: string, tenantId: string): Promise<Channels | null> {
  if (employeeScreens() === "off") return null;
  try {
    return await getChannels(token, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}
export const whatsappOn = async (token: string, tenantId: string): Promise<boolean> => (await readChannels(token, tenantId))?.whatsapp ?? true;
