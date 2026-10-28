/**
 * Does this session still owe the second step? Two-step sign-in is OPTIONAL for everybody (ADR 0115): a person who has not turned it on never owes it, so nothing is hidden or blocked for them. A person who HAS turned it on types the code once
 * when they sign in (the sign-in page asks, `proxy`), after which the session is aal2; only a session of that person that has not typed it yet still owes it, and the API then answers 403 `mfa_required`. The screens that hid an action behind
 * "set up your authenticator app" ask this instead of looking at the session level alone.
 */
export const secondFactorNeeded = (user: { aal: string; hasSecondFactor?: boolean }): boolean => user.hasSecondFactor === true && user.aal !== "aal2";
