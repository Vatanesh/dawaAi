import { Suspense } from "react";
import { AppProvider } from "@/components/app/app-context";
import { AppShell } from "@/components/app/AppShell";

export default function Home() {
  return (
    <Suspense>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </Suspense>
  );
}
