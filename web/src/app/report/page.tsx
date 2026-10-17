import type { Metadata } from "next";
import { Suspense } from "react";
import { Report } from "@/components/report/Report";

export const metadata: Metadata = { title: "Medication report" };

export default function ReportPage() {
  return (
    <Suspense>
      <Report />
    </Suspense>
  );
}
