import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** `/staff/login`: the address staff are given. A signed-out visitor never gets here: the proxy sends them to the normal sign-in (email, password, authenticator code) with `next=/staff/login`, and they come back to this page signed in; it only sends them on to the console. Nothing here decides access (the API's `/v1/admin/me` does). With the flag off the area is a 404 (the layout). */
export default function StaffLoginPage() {
  redirect("/staff");
}
