/**
 * The composer's Enter key (owner, 14 Nov): on a computer Enter sends and Shift+Enter is a new line; on a phone or tablet (a touch screen, no hardware keyboard) Enter is a new line and the send button sends.
 * Never while a keyboard is still composing a word (Telugu, Hindi, Kannada: keyCode 229 / isComposing).
 */
export const isTouchScreen = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

export function sendsOnEnter(e: { key: string; shiftKey: boolean; keyCode?: number; nativeEvent: { isComposing?: boolean } }, touch: boolean = isTouchScreen()): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && !touch;
}
