/**
 * The parts of "Teach this" a CLIENT component may import (the sources a line can come from and the length of a corrected answer). They live apart from ./source.ts because that file reads cookies and the API, which only the server may import.
 */
export const SOURCES = ["call", "chat", "practice"] as const;
export type Source = (typeof SOURCES)[number];
export const ANSWER_MIN = 2;
export const ANSWER_MAX = 600;
