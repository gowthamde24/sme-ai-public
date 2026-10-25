/**
 * Whether public sign-up is open (job DH). One setting, NEXT_PUBLIC_SIGNUP_OPEN: "0" closes it; anything else, or nothing, leaves it open as it always was (so a local stack and the real-stack runs need no setting).
 * It is only read by server code (the /signup page and the two sign-up actions), and the server reads it when it handles a request: it is not baked into the bundle (checked on a production build). The deploy scripts build the image
 * with "0" (deploy/cloudrun.sh: SIGNUP_OPEN=1 builds it open), so the image carries "0" until the owner opens sign-up, and a Cloud Run environment variable of the same name overrides that at start with no rebuild.
 * Supabase's own sign-up switch is a separate setting (off on staging).
 * When closed, /signup shows a friendly note and the early-access address instead of the form, and the sign-up actions refuse. Read at call time so a test can flip it.
 */
export function isSignupOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_SIGNUP_OPEN !== "0";
}
