import type { Metadata } from "next";
import { About } from "@/components/about/About";

export const metadata: Metadata = { title: "DawaAI: poly-pharmacy safety for caregivers" };

export default function AboutPage() {
  return <About />;
}
