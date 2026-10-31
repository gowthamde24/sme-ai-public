/**
 * Remembers the language pill's choice for the person (the API keeps it on their member profile): a plain POST to this app's OWN route `<workspace>/chat-language` (a path it is given), no token, never the API. Best effort: the pill already works
 * without it (the choice is also kept in this browser), so a failure changes nothing on screen.
 */
export async function saveChatLanguage(endpoint: string, language: string): Promise<void> {
  try {
    await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language }), credentials: "same-origin", cache: "no-store" });
  } catch {
    // offline: the browser's own copy holds
  }
}
