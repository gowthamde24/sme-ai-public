/**
 * Password policy for choosing a password (invite, reset). The Auth server enforces its own minimum
 * (set by hand on the hosted project, runbooks/hosted-auth-settings.md); this is the app's rule, checked
 * on the server, with messages that say what to change. Never logged, never echoed.
 */
export const MIN_PASSWORD = 12;
/** bcrypt's limit: a longer password would be silently truncated. */
export const MAX_PASSWORD = 72;

const COMMON = new Set([
  "password1234",
  "123456789012",
  "qwertyuiop12",
  "iloveyou1234",
  "welcome12345",
  "administrator",
  "letmein12345",
  "passwordpassword",
]);

export function validateNewPassword(
  password: string,
  confirm: string,
  email: string | null,
): string | null {
  if (password.length < MIN_PASSWORD)
    return `Use at least ${MIN_PASSWORD} characters. A few words in a row work well.`;
  if (password.length > MAX_PASSWORD)
    return `Use at most ${MAX_PASSWORD} characters.`;
  if (password !== confirm) return "The two passwords are not the same.";
  if (/^(.)\1+$/.test(password))
    return "That password repeats one character. Choose something harder to guess.";
  if (COMMON.has(password.toLowerCase()))
    return "That password is too common. Choose something harder to guess.";
  const local = email?.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local))
    return "Do not put your email name in your password.";
  return null;
}
