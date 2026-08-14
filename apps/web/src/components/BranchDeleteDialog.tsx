/** Confirms destructive deletion of a child branch and all descendants. */

import { Trash2 } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export const BranchDeleteDialog = memo(function BranchDeleteDialog({
  title,
  descendantCount,
  onOpenChange,
  onDelete,
}: {
  title: string;
  descendantCount: number;
  onOpenChange: (open: boolean) => void;
  onDelete: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !submitting && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-4 text-destructive" />
            {t("branch.deleteTitle")}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("branch.deleteDescription", { title, count: descendantCount })}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={() => {
              setSubmitting(true);
              void onDelete().finally(() => setSubmitting(false));
            }}
          >
            {t("branch.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
