/** Pure predicate for the dev-tools safety gate. */

function isLocalSiteUrl(siteUrl: string): boolean {
  return siteUrl.startsWith("http://localhost") || siteUrl.startsWith("http://127.0.0.1");
}

/** Dev tools require a localhost SITE_URL and the explicit opt-in flag. */
export function computeDevToolsEnabled(siteUrl: string, flagValue: string): boolean {
  return isLocalSiteUrl(siteUrl.trim()) && flagValue === "true";
}
