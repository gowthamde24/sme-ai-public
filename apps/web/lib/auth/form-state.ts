/** What an auth form shows after a submit: one error, or one message. Never a raw API body or a submitted value. */
export type AuthFormState = { error?: string; message?: string } | undefined;
