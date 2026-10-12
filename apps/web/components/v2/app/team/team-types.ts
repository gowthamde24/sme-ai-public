import type { Invitation, NewInvitation, RoleChange, Removed } from "@/lib/api/team";

import type { Failed } from "../cc/kit";

export type Out<T> = { ok: true; data: T } | Failed;
export interface TeamActions {
  invite: (invitationId: string, role: string, days: number, label: string) => Promise<Out<NewInvitation>>;
  revoke: (invitationId: string) => Promise<Out<Invitation>>;
  changeRole: (userId: string, role: string) => Promise<Out<RoleChange>>;
  remove: (userId: string, reason: string) => Promise<Out<Removed>>;
}
