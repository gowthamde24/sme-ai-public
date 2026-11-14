import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { NoAccessScreen, UnavailableScreen } from "@/components/v2/app/staff/PlainScreens";
import { StaffFrame } from "@/components/v2/app/staff/StaffFrame";
import { StaffSidebar } from "@/components/v2/app/staff/StaffSidebar";
import { loadStaff } from "@/lib/staff/load";

/**
 * The console's menu and frame around every screen (everything but the "session ended" page). It reads who the staff member is and the Overview's role, environment label and badges ONCE per request (the page shares that read). A staff session that ended goes to
 * /staff/signed-out; no staff access is one plain screen that never says why; anything else is "could not load". Nothing is drawn of the page then.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const state = await loadStaff();
  if (!state.ok) {
    if (state.failure === "signed_out") redirect("/staff/signed-out");
    return state.failure === "no_access" ? <NoAccessScreen /> : <UnavailableScreen />;
  }
  const path = ((await headers()).get("x-sme-path") ?? "").split("?")[0];
  const { me, overview, keep } = state.data;
  return (
    <StaffFrame menu={<StaffSidebar me={me} overview={overview} keep={keep} active={path.startsWith("/staff/businesses") ? "businesses" : path.startsWith("/staff/support") ? "support" : "overview"} />}>
      {children}
    </StaffFrame>
  );
}
