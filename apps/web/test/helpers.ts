import { vi } from "vitest";

/** Mimics next/navigation's redirect(): it throws, so code after it never runs. */
export class RedirectError extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

export const redirectMock = vi.fn((to: string): never => {
  throw new RedirectError(to);
});

export async function redirectTarget(
  run: () => Promise<unknown>,
): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof RedirectError) return error.to;
    throw error;
  }
}

type AuthMock = {
  getUser: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
};

/** A fake Supabase client. getSession() is only allowed to be read, never to authenticate. */
export function fakeSupabase(overrides: Partial<AuthMock> = {}) {
  const auth: AuthMock = {
    getUser: vi.fn(async () => ({
      data: { user: null },
      error: { message: "no session" },
    })),
    getSession: vi.fn(async () => ({ data: { session: null } })),
    signInWithPassword: vi.fn(async () => ({
      data: {},
      error: { message: "Invalid login credentials" },
    })),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
  return { auth };
}
