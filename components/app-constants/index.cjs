/** Shared product constants for web, backend, and desktop surfaces. */

const APP_NAME = "Convex Project Template";
const DEV_APP_NAME = "Convex Project Template (Dev)";

function getAppName(isDev = false) {
  return isDev ? DEV_APP_NAME : APP_NAME;
}

module.exports = {
  APP_NAME,
  DEV_APP_NAME,
  getAppName,
};
