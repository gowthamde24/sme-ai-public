"use client";

import dynamic from "next/dynamic";

/**
 * The JOBS versions of the Settings cards (Business, Language and theme, Notifications) and of the Team page, each a chunk of its own: drawn on the server like the rest and live when the chunk arrives, so the first load of Settings and Team carries none of them
 * (the route-JS budget counts that). JOBS off never loads them.
 */
export const BusinessSimple = dynamic(() => import("./BusinessSimple").then((m) => m.BusinessSimple));
export const LanguageSimple = dynamic(() => import("./LanguageSimple").then((m) => m.LanguageSimple));
export const NotificationsSimple = dynamic(() => import("./NotificationsSimple").then((m) => m.NotificationsSimple));
export const TeamMembersSimple = dynamic(() => import("./TeamSimple").then((m) => m.TeamMembersSimple));
export const InviteSimple = dynamic(() => import("./TeamSimple").then((m) => m.InviteSimple));
