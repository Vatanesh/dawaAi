"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// The force-graph library touches window on import, so it only loads in the browser.
export const GraphTab = dynamic(() => import("./GraphTab").then((m) => m.GraphTab), {
  ssr: false,
  loading: () => <Skeleton className="h-[520px] rounded-xl" />,
});
