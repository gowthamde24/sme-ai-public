"use client";

import * as React from "react";

import { takeNote } from "@/lib/client-actions/note";

/** The one line the assistant left for this page when it opened it (for example that a date word was not applied). Shown once, as plain text; gone on the next visit. */
export function AssistantNote() {
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => {
    // the note lives in this tab's storage, which the server cannot read: it is taken after the page is drawn (reading it while drawing would not match the server's page)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(takeNote("leads"));
  }, []);
  if (!text) return null;
  return (
    <p data-part="assistant-note" role="status" className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
      {text}
    </p>
  );
}
