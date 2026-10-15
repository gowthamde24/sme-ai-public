/** The moment now, in milliseconds. A page reads it here, once, so the day it shows and the buttons that depend on the day agree (and the lint rule against an impure call while drawing is kept: this is the one place that asks the clock). */
export const clock = (): number => Date.now();
