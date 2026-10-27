/** Failed sign-ins in a row, kept for 15 minutes in a cookie only the server can read (app/login/actions.ts). From `CHECK_AFTER` on, with Turnstile on, a sign-in needs the check box as well; the API and Supabase have their own limits besides. */
export const FAILS_COOKIE = "s19_signin_fails";
export const CHECK_AFTER = 3;
export const FAILS_SECONDS = 15 * 60;
