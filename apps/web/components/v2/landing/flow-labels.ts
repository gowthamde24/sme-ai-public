import { formatINR } from "@/design/format";
import type { LandingT } from "@/i18n/landing";
import { EXAMPLE_MONEY_HELD_RUPEES, EXAMPLE_QUOTE_RUPEES } from "@/components/v2/landing/example-data";

/**
 * Every string the client-side flow strip needs, already in the visitor's language. The server builds this and passes it
 * as props, so the four dictionaries never reach the browser bundle. (A function cannot cross the server/client
 * boundary, which is why this is plain data.)
 */
export interface FlowLabels {
  group: string;
  example: string;
  draft: string;
  pause: string;
  play: string;
  motionPlay: string;
  motionStop: string;
  dotsGroup: string;
  chip: string;
  steps: string[];
  dots: string[];
  cards: { leadT: string; leadS: string; researchT: string; researchS: string; req1: string; req2: string; quoteT: string; followupT: string; followupS: string; money: string };
}

const STEP_KEYS = ["lead", "research", "requirement", "quote", "followup", "order"] as const;

export function buildFlowLabels(t: LandingT): FlowLabels {
  const vars = { amount: formatINR(EXAMPLE_QUOTE_RUPEES), held: formatINR(EXAMPLE_MONEY_HELD_RUPEES, { decimals: 2 }) };
  const steps = STEP_KEYS.map((k) => t(`step.${k}.t`));
  return {
    group: t("flow.label"),
    example: t("flow.example"),
    draft: t("flow.draft"),
    pause: t("anim.pause"),
    play: t("anim.play"),
    motionPlay: t("anim.motionPlay"),
    motionStop: t("anim.motionStop"),
    dotsGroup: t("anim.dots"),
    chip: t("card.lead.t").split(",")[0],
    steps,
    dots: steps.map((name, i) => t("anim.dot", { n: i + 1, name })),
    cards: {
      leadT: t("card.lead.t"),
      leadS: t("card.lead.s"),
      researchT: t("card.research.t"),
      researchS: t("card.research.s"),
      req1: t("card.requirement.c1"),
      req2: t("card.requirement.c2"),
      quoteT: t("card.quote.t", vars),
      followupT: t("card.followup.t"),
      followupS: t("card.followup.s"),
      money: t("ctl.money", vars),
    },
  };
}
