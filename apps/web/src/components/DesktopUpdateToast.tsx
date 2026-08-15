/** Announces a downloaded desktop update once per app session. */

import { memo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type DownloadedDesktopUpdate = {
  version: string;
  releaseName?: string;
  releaseDate?: string;
};

type DesktopUpdateBridge = {
  claimDownloadedUpdate?: () => Promise<DownloadedDesktopUpdate | undefined>;
  onUpdateDownloaded?: (callback: (update: DownloadedDesktopUpdate) => void) => void;
  offUpdateDownloaded?: (callback: (update: DownloadedDesktopUpdate) => void) => void;
  openUpdateChangelog?: () => Promise<void>;
  installDownloadedUpdate?: () => Promise<void>;
};

function updateBridge(): DesktopUpdateBridge | undefined {
  return window.monteCarloDesktop as DesktopUpdateBridge | undefined;
}

export const DesktopUpdateToast = memo(function DesktopUpdateToast() {
  const { ready, t } = useTranslation();

  // lint-allow: no-direct-use-effect — Electron update events enter React through the preload bridge.
  useEffect(() => {
    if (!ready) return;
    const bridge = updateBridge();
    if (
      !bridge?.claimDownloadedUpdate ||
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
    const showDownloadedUpdate = async () => {
      if (!active) return;
      const update = await bridge.claimDownloadedUpdate?.();
      if (!update) return;
      const version = update.version.trim();
      if (!version) return;
      const releaseName = update.releaseName?.trim();

      toast(t("updates.available"), {
        id: "desktop-update-ready",
        testId: "desktop-update-ready",
        description: releaseName || t("updates.ready", { version }),
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
            {t("updates.seeChanges")}
          </button>
        ),
        action: {
          label: t("updates.restart"),
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

    const handleUpdateDownloaded = () => {
      void showDownloadedUpdate().catch(() => undefined);
    };

    bridge.onUpdateDownloaded(handleUpdateDownloaded);
    void showDownloadedUpdate().catch(() => undefined);

    return () => {
      active = false;
      bridge.offUpdateDownloaded?.(handleUpdateDownloaded);
    };
  }, [ready, t]);

  return null;
});
