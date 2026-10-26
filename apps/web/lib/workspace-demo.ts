/**
 * Is this workspace one of the DEMO workspaces (job DQ part 0)? The staging demo workspaces are named "DEMO ... (synthetic)" (scripts/seed_staging.py), and a demo says what it is on the screens that would otherwise
 * frighten an owner ("Sending is stopped"). The name is only a hint for the wording: it decides no access. The API does not say it yet (asked of C1 in c2-questions-3.md); when it does, this reads that instead.
 */
export const isDemoWorkspace = (name: string | null | undefined): boolean => typeof name === "string" && /^DEMO\b/.test(name.trim());
