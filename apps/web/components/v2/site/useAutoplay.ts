"use client";

import { useEffect, useState } from "react";

import { useMedia } from "@/components/v2/landing/hooks";

/**
 * The shared clock of the two animated blocks of the home page (job CX): a counter that moves on by one every `every` ms while it is playing. It never plays for a visitor who asked for less motion (`prefers-reduced-motion`),
 * and `paused` is the visitor's own switch (the pause button, or touching a tab). The server draws the first item; the first tick is a whole interval later, so nothing moves before the page is read.
 */
export function useAutoplay(length: number, every: number): { index: number; setIndex: (i: number) => void; paused: boolean; setPaused: (p: boolean) => void; reduced: boolean; playing: boolean } {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const playing = !paused && !reduced;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % length), every);
    return () => clearInterval(id);
  }, [playing, length, every]);
  return { index, setIndex, paused, setPaused, reduced, playing };
}
