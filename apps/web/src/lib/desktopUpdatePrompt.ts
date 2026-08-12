/** Tracks whether this renderer session has already announced a downloaded desktop update. */

export const DESKTOP_UPDATE_TOAST_SESSION_KEY = "monte-carlo:desktop-update-toast-shown";

let claimedInThisRenderer = false;

type SessionStorageLike = Pick<Storage, "getItem" | "setItem">;

/**
 * Claims the single update prompt allowed for the current app session.
 *
 * sessionStorage survives renderer reloads but is discarded with the Electron
 * window. The in-memory fallback keeps the rule intact when storage is blocked.
 */
export function claimDesktopUpdateToast(storage?: SessionStorageLike): boolean {
  if (claimedInThisRenderer) return false;

  try {
    if (storage?.getItem(DESKTOP_UPDATE_TOAST_SESSION_KEY) === "true") {
      claimedInThisRenderer = true;
      return false;
    }
    storage?.setItem(DESKTOP_UPDATE_TOAST_SESSION_KEY, "true");
  } catch {
    // A blocked sessionStorage must not prevent an already downloaded update from being offered.
  }

  claimedInThisRenderer = true;
  return true;
}
