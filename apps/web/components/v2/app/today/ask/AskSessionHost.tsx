"use client";

import * as React from "react";

import { publishSession } from "./ask-store";
import { useAskSession, type AskSessionOptions } from "./use-ask-session";

/**
 * Runs the workspace's conversation (job DQ part 0): the one place that calls useAskSession for the layout. It draws nothing; after every render it hands the session to the store (ask-store.ts), where Today's card and the floating panel
 * read it, and it takes it back when the workspace is left. It is loaded as a chunk of its own (AskProvider), so the code that streams an answer and records a question is not in the first load of every page.
 */
export function AskSessionHost(options: AskSessionOptions) {
  const session = useAskSession(options);
  React.useEffect(() => {
    publishSession(session);
  });
  React.useEffect(() => () => publishSession(null), []);
  return null;
}
