/** Announces a downloaded desktop update once per app session. */

import { memo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { claimDesktopUpdateToast } from "@/lib/desktopUpdatePrompt";

type DownloadedDesktopUpdate = {
  version: string;
  releaseDate?: string;
};

type DesktopUpdateBridge = {
  getDownloadedUpdate?: () => Promise<DownloadedDesktopUpdate | undefined>;
  onUpdateDownloaded?: (callback: (update: DownloadedDesktopUpdate) => void) => void;
  offUpdateDownloaded?: (callback: (update: DownloadedDesktopUpdate) => void) => void;
  openUpdateChangelog?: () => Promise<void>;
  installDownloadedUpdate?: () => Promise<void>;
};

function updateBridge(): DesktopUpdateBridge | undefined {
  return window.monteCarloDesktop as DesktopUpdateBridge | undefined;
}

function rendererSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export const DesktopUpdateToast = memo(function DesktopUpdateToast() {
  const { ready, t } = useTranslation();

  // lint-allow: no-direct-use-effect — Electron update events enter React through the preload bridge.
  useEffect(() => {
    if (!ready) return;
    const bridge = updateBridge();
    if (
      !bridge?.getDownloadedUpdate ||
      !bridge.onUpdateDownloaded ||
      !bridge.offUpdateDownloaded ||
      !bridge.openUpdateChangelog ||
      !bridge.installDownloadedUpdate
    ) {
      return;
    }
    const openUpdateChangelog = bridge.openUpdateChangelog;
    const installDownloadedUpdate = bridge.installDownloadedUpdate;

    let active = true;
    const showDownloadedUpdate = (update: DownloadedDesktopUpdate) => {
      const version = update.version.trim();
      if (!active || !version || !claimDesktopUpdateToast(rendererSessionStorage())) return;

      toast(t("updates.ready", { version }), {
        id: "desktop-update-ready",
        testId: "desktop-update-ready",
        duration: Number.POSITIVE_INFINITY,
        dismissible: true,
        closeButton: true,
        cancel: (
          <button
            type="button"
            data-button=""
            data-cancel=""
            onClick={() => {
              void openUpdateChangelog().catch(() => {
                toast.error(t("updates.changelogError"));
              });
            }}
          >
            {t("updates.seeChangelog")}
          </button>
        ),
        action: {
          label: t("updates.install"),
          onClick: (event) => {
            event.preventDefault();
            void installDownloadedUpdate()
              .then(() => toast.dismiss("desktop-update-ready"))
              .catch(() => {
                toast.error(t("updates.installError"));
              });
          },
        },
      });
    };

    bridge.onUpdateDownloaded(showDownloadedUpdate);
    void bridge
      .getDownloadedUpdate()
      .then((update) => {
        if (update) showDownloadedUpdate(update);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      bridge.offUpdateDownloaded?.(showDownloadedUpdate);
    };
  }, [ready, t]);

  return null;
});
