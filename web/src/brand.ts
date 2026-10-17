// White-label configuration. Partners (insurers, hospital networks, care facilities) re-brand the app
// with environment variables only; no code changes.
export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "DawaAI",
  tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE || "Medication safety for the people you care for",
  /** Hex colour that replaces the default pharmacy green everywhere (buttons, focus rings, charts). */
  color: process.env.NEXT_PUBLIC_BRAND_COLOR || undefined,
  /** Shown in the footer of printed reports, e.g. "Provided by Example Care Partner". */
  partner: process.env.NEXT_PUBLIC_BRAND_PARTNER || undefined,
};
