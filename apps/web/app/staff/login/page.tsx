import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** `/staff/login`: the address staff are given. Staff sign in through the same login as everyone (email, password, authenticator code) and come back to the console: this only sends them there with `next=/staff`. Nothing here decides access (the API's `/v1/admin/me` does). With the flag off the area is a 404 (the layout). */
export default function StaffLoginPage() {
  redirect("/login?next=%2Fstaff");
}
