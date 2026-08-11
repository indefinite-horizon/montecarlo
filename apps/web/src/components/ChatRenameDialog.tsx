/** Renames a durable chat without changing its project or activity order. */

import { Pencil } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

export const ChatRenameDialog = memo(function ChatRenameDialog({
  initialTitle,
  open,
  onOpenChange,
  onRename,
}: {
  initialTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (title: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && submitting) return;
    onOpenChange(nextOpen);
  };

  const submit = async () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || normalizedTitle === initialTitle || submitting) return;
    setSubmitting(true);
    try {
      if (await onRename(normalizedTitle)) onOpenChange(false);
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
              <Pencil className="size-4 text-primary" />
              {t("sidebar.renameChat")}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-2">
            <label htmlFor="rename-chat-title" className="text-xs font-semibold">
              {t("sidebar.chatName")}
            </label>
            <Input
              id="rename-chat-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || title.trim() === initialTitle || submitting}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
});
