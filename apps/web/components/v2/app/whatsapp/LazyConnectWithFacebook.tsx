"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Card = lazy(() => import("./ConnectWithFacebook"));

/** The "Connect with Facebook" card as its own lazy chunk (the page's first load must stay under its route-JS ceiling; Meta's SDK is loaded only when the button is pressed). Same props as `ConnectWithFacebook`. */
export function ConnectWithFacebook(props: ComponentProps<typeof Card>) {
  return (
    <Suspense fallback={null}>
      <Card {...props} />
    </Suspense>
  );
}
