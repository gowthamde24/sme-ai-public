import type { OrbState } from "@/components/v2/Orb";

import type { AiMood } from "./mood";

/** What the circle does for each mood of the Ask box: it thinks while a question is out or the microphone listens, speaks while an answer arrives or is read out, and is still when nothing happens or the AI is resting. */
export const orbStateOf = (mood: AiMood | undefined): OrbState => (mood === "thinking" || mood === "listening" ? "think" : mood === "answering" ? "speak" : "still");
