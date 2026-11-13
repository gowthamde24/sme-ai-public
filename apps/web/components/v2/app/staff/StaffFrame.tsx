import type { ReactNode } from "react";

/** The console's two columns: the side menu and the work area (`main`). */
export function StaffFrame({ menu, children }: { menu: ReactNode; children: ReactNode }) {
  return (
    <div className="sc-app">
      {menu}
      <main className="sc-main" id="main">
        {children}
      </main>
    </div>
  );
}
