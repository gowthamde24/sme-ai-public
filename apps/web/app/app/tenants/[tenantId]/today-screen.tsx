import { redirect } from "next/navigation";

import { TodayView } from "@/components/v2/app/today/TodayView";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { pageMain } from "@/components/v2/app/ui";

import { readDisplayName, readToday } from "./today-data";

/** The hour in India, where the business is: the greeting does not depend on the server's clock zone. */
function hourInIndia(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
}

/** The default screen of a workspace (the home with no `?tab=`): Today. The records tables are Customers and Leads (`?tab=`). Server side; the page has already run requireUser and fetchTenant. */
export async function TodayScreen({ accessToken, userId, tenantId }: { accessToken: string; userId: string; tenantId: string }) {
  const lang = await getLang();
  const t = appT(lang);
  let data, name;
  try {
    [data, name] = await Promise.all([readToday(accessToken, tenantId), readDisplayName(accessToken, tenantId, userId)]);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    throw error;
  }
  return (
    <main className={pageMain} lang={lang}>
      <TodayView data={data} name={name} hour={hourInIndia()} base={`/app/tenants/${tenantId}`} t={(key, vars) => t(key as "frame.notyet", vars)} />
    </main>
  );
}
