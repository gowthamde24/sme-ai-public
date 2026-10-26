/**
 * Is this workspace one of the DEMO workspaces (job DQ part 0)? The staging demo workspaces are named "DEMO ... (synthetic)" (scripts/seed_staging.py), and a demo says what it is on the screens that would otherwise
 * frighten an owner ("Sending is stopped"). The API says it (`demo` on `GET /billing/access`, from C1's answer of 27 Oct): that word wins. Where the API in use does not send it yet (not deployed), the name is the fallback hint. It decides no access, only the wording.
 */
export const isDemoWorkspace = (name: string | null | undefined, apiDemo?: boolean | null): boolean => (typeof apiDemo === "boolean" ? apiDemo : typeof name === "string" && /^DEMO\b/.test(name.trim()));
