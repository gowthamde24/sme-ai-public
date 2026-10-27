import * as React from "react";

/** Turns the assistant on for the workspace: the server action of the tenant, bound. `null` = this person may not (the line says whom to ask). Its own tiny file, so the layout does not carry the line's code. */
export type TurnOn = () => Promise<{ ok: true; live: boolean } | { ok: false }>;
export const AskTurnOnContext = React.createContext<TurnOn | null>(null);
