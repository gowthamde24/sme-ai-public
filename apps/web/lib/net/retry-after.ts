/** The wait a Retry-After header asks for, in ms (whole seconds, 1 to 9999); 0 when there is none or it is not a number. */
export const retryAfterMs = (header: string | null): number => {
  const n = Number(header);
  return n >= 1 && n <= 9999 ? Math.trunc(n) * 1000 : 0;
};
