/**
 * The release this build came from, as the Musik-Werkstatt release script
 * passes it (VITE_APP_COMMIT, VITE_APP_BUILT_AT); local builds say so.
 */
export function versionLabel(commit: string | undefined = import.meta.env.VITE_APP_COMMIT, builtAt: string | undefined = import.meta.env.VITE_APP_BUILT_AT): string {
  if (!commit) return "lokaler Build";
  const date = builtAt ? new Date(builtAt) : null;
  const day = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" })
    : "";
  return `Version ${commit.slice(0, 7)}${day ? ` vom ${day}` : ""}`;
}
