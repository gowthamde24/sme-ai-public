/**
 * Whether public sign-up is open (job DH). One build-time setting, like the launch switch of the public site (lib/seo/site.ts): NEXT_PUBLIC_SIGNUP_OPEN="0" closes it; anything else, or nothing, leaves it open as it always was
 * (so a local stack and the real-stack runs need no setting). The deploy scripts build with "0" until the owner opens sign-up (deploy/cloudrun.sh: SIGNUP_OPEN=1), because Supabase's own sign-up switch is off on staging.
 * When closed, /signup shows a friendly note and the early-access address instead of the form, and the sign-up actions refuse. Read at call time so a test can flip it.
 */
export function isSignupOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_SIGNUP_OPEN !== "0";
}
