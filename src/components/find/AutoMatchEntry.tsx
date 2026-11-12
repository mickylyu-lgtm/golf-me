import { useState } from "react";
import type { ReactNode } from "react";

import { AutoMatchStartedAt } from "../../lib/autoMatchStart";

// Lives outside the route Suspense boundary so the lazy-loading radar counts
// toward the same minimum. A new navigation gets its own entry instance.
export function AutoMatchEntry({ children }: { children: ReactNode }) {
  const [startedAt] = useState(() => performance.now());
  return <AutoMatchStartedAt.Provider value={startedAt}>{children}</AutoMatchStartedAt.Provider>;
}
