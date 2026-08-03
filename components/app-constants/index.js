/** Shared product constants for web, backend, and desktop surfaces. */

export const APP_NAME = "Monte Carlo";
export const DEV_APP_NAME = "Monte Carlo (Dev)";

export function getAppName(isDev = false) {
  return isDev ? DEV_APP_NAME : APP_NAME;
}
