/** Creates a workspace project in a focused modal flow. */

import { FolderPlus } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

export const ProjectCreateDialog = memo(function ProjectCreateDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && submitting) return;
    if (!nextOpen) setName("");
    onOpenChange(nextOpen);
  };

  const submit = async () => {
    const normalizedName = name.trim();
    if (!normalizedName || submitting) return;
    setSubmitting(true);
    try {
      if (await onCreate(normalizedName)) {
        setName("");
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="size-4 text-primary" />
              {t("sidebar.newProject")}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-2">
            <label htmlFor="new-project-name" className="text-xs font-semibold">
              {t("sidebar.projectName")}
            </label>
            <Input
              id="new-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || submitting}>
              {t("sidebar.createProject")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
});
