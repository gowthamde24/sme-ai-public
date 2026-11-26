"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Own = lazy(() => import("./OwnMessages").then((m) => ({ default: m.OwnMessages })));

/** "Your own messages" as its own lazy chunk (Chats > Templates is tight on its route-JS ceiling; the builder inside is a second chunk, loaded only when "Make a new message" is tapped). Same props as `OwnMessages`. */
export function OwnMessages(props: ComponentProps<typeof Own>) {
  return (
    <Suspense fallback={<span aria-hidden="true" data-skeleton="" className="jb-skeleton block h-28 rounded-xl" />}>
      <Own {...props} />
    </Suspense>
  );
}
