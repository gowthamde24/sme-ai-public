import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { employeeScreens, jobsScreens } from "@/lib/screens/flag";

/** A second guard (like the jobs layout): with EMPLOYEES or JOBS off these pages answer "not found". */
export default function EmployeesLayout({ children }: { children: ReactNode }) {
  if (employeeScreens() === "off" || jobsScreens() === "off") notFound();
  return children;
}
