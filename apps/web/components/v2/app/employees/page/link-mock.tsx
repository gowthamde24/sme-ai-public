import * as React from "react";

/** `next/link` for the unit tests: a plain anchor (the router is not there). */
export default function Link({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean; className?: string }) {
  return (
    <a href={href} data-prefetch={prefetch === false ? "off" : undefined} {...rest}>
      {children}
    </a>
  );
}
