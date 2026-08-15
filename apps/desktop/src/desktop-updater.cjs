/** Owns the signed desktop update lifecycle without exposing update URLs to the renderer. */

const updateCheckDelayMs = 5_000;
const updateCheckIntervalMs = 4 * 60 * 60 * 1_000;
const changelogReleaseBaseUrl = "https://github.com/indefinite-horizon/montecarlo/releases/tag";
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;

function normalizeReleaseName(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized && normalized.length <= 160 ? normalized : undefined;
}

function normalizeDownloadedUpdate(updateInfo) {
  const version = typeof updateInfo?.version === "string" ? updateInfo.version.trim() : "";
  if (!versionPattern.test(version)) return undefined;
  return Object.freeze({
    version,
    releaseName: normalizeReleaseName(updateInfo.releaseName),
    releaseDate:
      typeof updateInfo.releaseDate === "string" && updateInfo.releaseDate.length <= 128
        ? updateInfo.releaseDate
        : undefined,
  });
}

function changelogUrl(version) {
  if (!versionPattern.test(version)) throw new Error("Invalid desktop update version.");
  return `${changelogReleaseBaseUrl}/v${encodeURIComponent(version)}`;
}

function createDesktopUpdater({
  autoUpdater,
  broadcast,
  openExternal,
  prepareToInstall,
  reportDiagnostic,
}) {
  let downloadedUpdate;
  let updateAnnouncementClaimed = false;
  let installStarted = false;
  let checkTimer;
  let intervalTimer;

  async function check() {
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      reportDiagnostic("update_check_failed", "The desktop update feed could not be checked.");
    }
  }

  function start() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.fullChangelog = true;
    autoUpdater.on("update-downloaded", (updateInfo) => {
      const normalized = normalizeDownloadedUpdate(updateInfo);
      if (!normalized) {
        reportDiagnostic("update_metadata_rejected", "Downloaded update metadata was invalid.");
        return;
      }
      downloadedUpdate = normalized;
      broadcast("desktop-update:downloaded", normalized);
    });
    autoUpdater.on("error", () => {
      reportDiagnostic("update_error", "The desktop updater encountered an error.");
    });

    checkTimer = setTimeout(() => void check(), updateCheckDelayMs);
    checkTimer.unref();
    intervalTimer = setInterval(() => void check(), updateCheckIntervalMs);
    intervalTimer.unref();
  }

  function claimDownloadedUpdate() {
    if (!downloadedUpdate || updateAnnouncementClaimed) return undefined;
    updateAnnouncementClaimed = true;
    return downloadedUpdate;
  }

  async function openChangelog() {
    if (!downloadedUpdate) throw new Error("No downloaded update is available.");
    await openExternal(changelogUrl(downloadedUpdate.version));
  }

  async function install() {
    if (!downloadedUpdate) throw new Error("No downloaded update is available.");
    if (installStarted) return;
    installStarted = true;
    try {
      await prepareToInstall();
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      installStarted = false;
      throw error;
    }
  }

  function dispose() {
    if (checkTimer) clearTimeout(checkTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  }

  return Object.freeze({ claimDownloadedUpdate, dispose, install, openChangelog, start });
}

module.exports = {
  changelogUrl,
  createDesktopUpdater,
  normalizeDownloadedUpdate,
  normalizeReleaseName,
};
