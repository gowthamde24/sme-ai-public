"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Labels } from "../labels";

const LabelsContext = createContext<Labels>(undefined);

/** The frame's words in the person's language, for the client parts that cannot take them as props (an error boundary is rendered by Next, not by a page). Set once by AppFrame. */
export function LabelsProvider({ labels, children }: { labels: Labels; children: ReactNode }) {
  return <LabelsContext.Provider value={labels}>{children}</LabelsContext.Provider>;
}

export const useLabels = (): Labels => useContext(LabelsContext);
