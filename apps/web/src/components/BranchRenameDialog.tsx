/** Renames a child branch without changing its graph position. */

import { GitBranch } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

export const BranchRenameDialog = memo(function BranchRenameDialog({
  initialTitle,
  onOpenChange,
  onRename,
}: {
  initialTitle: string;
  onOpenChange: (open: boolean) => void;
  onRename: (title: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [submitting, setSubmitting] = useState(false);
  const normalized = title.trim();

  return (
    <Dialog open onOpenChange={(open) => !submitting && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!normalized || normalized === initialTitle || submitting) return;
            setSubmitting(true);
            void onRename(normalized).finally(() => setSubmitting(false));
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="size-4 text-primary" />
              {t("branch.renameTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <label htmlFor="rename-branch-title" className="text-xs font-semibold">
              {t("branch.name")}
            </label>
            <Input
              id="rename-branch-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!normalized || normalized === initialTitle || submitting}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
});
