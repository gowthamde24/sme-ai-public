/**
 * The cookie the browser keeps while it is away at Google or Facebook (job DQ part 2): "google" or "facebook" when the person ticked the separate box for news and offers on the sign-up page, so the first sign-in can record that choice
 * with the API (a person who signs up by e-mail carries it in the account's metadata instead). Not set when the box was not ticked. httpOnly, one hour, deleted when it has been used.
 */
export const SIGNUP_MARKETING_COOKIE = "sme_signup_marketing";
