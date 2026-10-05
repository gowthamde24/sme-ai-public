/** The Auth server hands back the QR code as an SVG data URI. Only that shape is ever put in an <img>. */
export function safeQr(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("data:image/svg+xml")
    ? value
    : null;
}
