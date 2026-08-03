/** Shared product constants for web, backend, and desktop surfaces. */

export const APP_NAME = "Convex Project Template";
export const DEV_APP_NAME = "Convex Project Template (Dev)";

export function getAppName(isDev = false) {
  return isDev ? DEV_APP_NAME : APP_NAME;
}
