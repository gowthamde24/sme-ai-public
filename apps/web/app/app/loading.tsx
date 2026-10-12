import { PageSkeleton } from "@/components/v2/app/robust/Skeleton";

/**
 * What every screen under /app shows while its data is on the way (job BW): the frame (menu, top bar) is already drawn by the layout, and the page area holds the shape of a page, announced once as "Loading…".
 * After eight seconds it says it is taking longer than usual. A screen that has its own loading.tsx keeps it.
 */
export default function Loading() {
  return <PageSkeleton />;
}
