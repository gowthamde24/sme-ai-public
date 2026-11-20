"use client";

import dynamic from "next/dynamic";

/** The parts of My assistant that are interactive, each as a chunk of its own (the route-JS budget counts the first load): the Practice panel (the orb, the voice conversation, typing), the voice card ("Your assistant's voice") and the greeting card. */
export const PracticePanel = dynamic(() => import("./PracticePanel").then((m) => m.PracticePanel));
export const VoiceCard = dynamic(() => import("./VoiceCard").then((m) => m.VoiceCard));
export const TalkToYou = dynamic(() => import("./TalkToYou").then((m) => m.TalkToYou));
export const VoiceTone = dynamic(() => import("./VoiceTone").then((m) => m.VoiceTone));
/** Questions and answers + "add your website" (the knowledge base of the Lead Desk setup, step 1) as a chunk of its own. */
export const KnowledgeStep = dynamic(() => import("../lead-setup/KnowledgeStep").then((m) => m.KnowledgeStep));
export const CallLimitCard = dynamic(() => import("./CallLimitCard").then((m) => m.CallLimitCard));
