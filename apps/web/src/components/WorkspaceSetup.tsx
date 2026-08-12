/** Creates a local workspace during the local-only product phase. */

import { ArrowRight, Database } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

export const WorkspaceSetup = memo(function WorkspaceSetup({
  loading,
  onClose,
  onCreate,
}: {
  loading: boolean;
  onClose: () => void;
  onCreate: (input: { name: string }) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(t("workspace.defaultName"));
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const normalizedName = name.trim();
    if (!normalizedName || submitting) return;
    setSubmitting(true);
    try {
      if (await onCreate({ name: normalizedName })) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader className="flex-row items-center gap-4 space-y-0 border-b border-border p-6 text-left">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-foreground text-background">
              <Database className="size-5 text-primary" />
            </span>
            <DialogTitle className="min-w-0 flex-1 font-display text-2xl font-bold">
              {t("workspace.newWorkspace")}
            </DialogTitle>
          </DialogHeader>

          <div className="p-6">
            <div className="rounded-lg border border-border bg-card p-4">
              <label htmlFor="workspace-name" className="text-xs font-semibold">
                {t("workspace.nameLabel")}
              </label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-2 h-10 bg-background"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-border bg-secondary/25 px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || submitting || loading}>
              {t("workspace.createLocal")}
              <ArrowRight />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
});
