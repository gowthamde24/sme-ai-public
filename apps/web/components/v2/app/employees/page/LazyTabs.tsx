"use client";

import { Suspense, lazy, type ComponentProps } from "react";

import { Skeleton } from "../../ds/Skeleton";

/** Each tab body is a chunk of its own (the page's route JS stays small); a quiet block of grey is drawn while it loads. */
const Overview = lazy(() => import("./OverviewTab").then((m) => ({ default: m.OverviewTab })));
const Voice = lazy(() => import("./VoiceTab").then((m) => ({ default: m.VoiceTab })));
const Rules = lazy(() => import("./RulesTab").then((m) => ({ default: m.RulesTab })));
const Responsibilities = lazy(() => import("./ResponsibilitiesTab").then((m) => ({ default: m.ResponsibilitiesTab })));
const Activity = lazy(() => import("./ActivityTab").then((m) => ({ default: m.ActivityTab })));
const Phone = lazy(() => import("./PhoneTab").then((m) => ({ default: m.PhoneTab })));

const fallback = (
  <div aria-hidden="true" className="flex flex-col gap-3">
    <Skeleton className="h-24 rounded-xl" />
    <Skeleton className="h-40 rounded-xl" />
  </div>
);
const wrap = (node: React.ReactNode) => <Suspense fallback={fallback}>{node}</Suspense>;

export const OverviewTab = (p: ComponentProps<typeof Overview>) => wrap(<Overview {...p} />);
export const VoiceTab = (p: ComponentProps<typeof Voice>) => wrap(<Voice {...p} />);
export const RulesTab = (p: ComponentProps<typeof Rules>) => wrap(<Rules {...p} />);
export const ResponsibilitiesTab = (p: ComponentProps<typeof Responsibilities>) => wrap(<Responsibilities {...p} />);
export const ActivityTab = (p: ComponentProps<typeof Activity>) => wrap(<Activity {...p} />);
export const PhoneTab = (p: ComponentProps<typeof Phone>) => wrap(<Phone {...p} />);
