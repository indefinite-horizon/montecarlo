/** Shared product constants for web, backend, and desktop surfaces. */

const APP_NAME = "Monte Carlo";
const DEV_APP_NAME = "Monte Carlo (Dev)";

function getAppName(isDev = false) {
  return isDev ? DEV_APP_NAME : APP_NAME;
}

module.exports = {
  APP_NAME,
  DEV_APP_NAME,
  getAppName,
};
