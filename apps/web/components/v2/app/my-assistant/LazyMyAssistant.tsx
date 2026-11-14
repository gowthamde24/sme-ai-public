"use client";

import dynamic from "next/dynamic";

/** The parts of My assistant that are interactive, each as a chunk of its own (the route-JS budget counts the first load): the Practice panel (the orb, the voice conversation, typing), the voice cards and the segmented control over "How your assistant speaks". */
export const PracticePanel = dynamic(() => import("./PracticePanel").then((m) => m.PracticePanel));
export const VoiceCards = dynamic(() => import("./VoiceCards").then((m) => m.VoiceCards));
export const TalkToYou = dynamic(() => import("./TalkToYou").then((m) => m.TalkToYou));
export const VoiceSegments = dynamic(() => import("./VoiceSegments").then((m) => m.VoiceSegments));
/** Questions and answers + "add your website" (the knowledge base of the Lead Desk setup, step 1) as a chunk of its own. */
export const KnowledgeStep = dynamic(() => import("../lead-setup/KnowledgeStep").then((m) => m.KnowledgeStep));
