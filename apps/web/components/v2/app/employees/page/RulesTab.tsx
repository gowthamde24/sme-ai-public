"use client";

import { AutonomyCard, HandoverCard } from "./AutonomyCard";
import { HoursCard } from "./HoursCard";
import { DefaultNote, type TabProps } from "./shared";
import { InstructionsCard, NeverSayCard } from "./WordsCard";

/**
 * Rules: what it may do alone and what it asks first, when it hands over, its working hours, the words it never says and the owner's own instructions. The main assistant keeps its ask-first, may-do, hand-over and hours in My assistant (shown, not editable); its never-say words
 * and instructions are edited here like any other employee's.
 */
export function RulesTab(props: TabProps) {
  const locked = !props.canEdit || props.emp.isDefault;
  return (
    <>
      {props.emp.isDefault ? <DefaultNote words={props.words} base={props.base} /> : null}
      <AutonomyCard {...props} locked={locked} />
      <HandoverCard {...props} locked={locked} />
      <HoursCard {...props} locked={locked} />
      <NeverSayCard {...props} />
      <InstructionsCard {...props} />
    </>
  );
}
