/**
 * Is the Auth server's address for signing in with a provider "on"? (job CL) `signInWithOAuth` only BUILDS that address; whether the provider is switched on shows when the address is followed (the real-stack run found
 * a browser landing on a JSON 400 page). So the address is asked once from the server WITHOUT following it: a provider that is on answers with a redirect to the provider, one that is off with a refusal. Any refusal,
 * error or silence counts as "not available". The address is the Auth server's own (it holds no token and no secret); nothing here goes to the API.
 */
export async function providerIsOn(authorizeUrl: string): Promise<boolean> {
  try {
    const answer = await fetch(authorizeUrl, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8000) });
    return answer.status >= 300 && answer.status < 400;
  } catch {
    return false;
  }
}
