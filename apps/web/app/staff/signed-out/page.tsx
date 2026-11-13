import { SignedOutScreen } from "@/components/v2/app/staff/PlainScreens";

export const dynamic = "force-dynamic";

/** "Your staff session ended" (the API's 401 session_ended: 30 minutes without a call): a plain page outside the console's menu, with one button that ends this browser's session and opens the sign-in page. */
export default function StaffSignedOutPage() {
  return <SignedOutScreen />;
}
