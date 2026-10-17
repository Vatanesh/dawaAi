import type { MetadataRoute } from "next";
import { brand } from "@/brand";

// Installable on phones as a home-screen app (the white-label mobile channel).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.name,
    short_name: brand.name,
    description: brand.tagline,
    start_url: "/app",
    display: "standalone",
    background_color: "#f5f7f6",
    theme_color: brand.color ?? "#0e7c66",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
