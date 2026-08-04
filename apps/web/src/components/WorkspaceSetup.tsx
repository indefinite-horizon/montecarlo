/** Lets users create portable local or cloud workspaces. */

import { ArrowRight, Cloud, Database, HardDrive, X } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export const WorkspaceSetup = memo(function WorkspaceSetup({
  activeWorkspaceId,
  loading,
  onClose,
  onCreate,
  onSelect,
  workspaces,
}: {
  activeWorkspaceId?: string;
  loading: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; storageMode: "local" | "cloud" }) => Promise<boolean>;
  onSelect: (workspaceId: string) => void;
  workspaces: Array<{ id: string; name: string; storageMode: "local" | "cloud" }>;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [name, setName] = useState(t("workspace.defaultName"));
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const normalizedName = name.trim();
    if (!normalizedName || submitting) return;
    setSubmitting(true);
    try {
      if (await onCreate({ name: normalizedName, storageMode: mode })) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-foreground/20 p-4 backdrop-blur-sm">
      <section
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-setup-title"
      >
        <header className="flex items-start gap-4 border-b border-border p-6">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-foreground text-background">
            <Database className="size-5 text-primary" />
          </span>
          <h2 id="workspace-setup-title" className="min-w-0 flex-1 font-display text-2xl font-bold">
            {t("workspace.setupTitle")}
          </h2>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label={t("common.close")}>
            <X />
          </Button>
        </header>

        <div className="p-6">
          {workspaces.length > 0 ? (
            <section
              className="mb-5 border-b border-border pb-5"
              aria-labelledby="workspace-list-title"
            >
              <p
                id="workspace-list-title"
                className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              >
                {t("workspace.existingTitle")}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {workspaces.map((workspace) => {
                  const Icon = workspace.storageMode === "local" ? HardDrive : Cloud;
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent",
                        workspace.id === activeWorkspaceId
                          ? "border-primary bg-accent/60"
                          : "border-border bg-card",
                      )}
                      aria-pressed={workspace.id === activeWorkspaceId}
                      onClick={() => {
                        onSelect(workspace.id);
                        onClose();
                      }}
                    >
                      <Icon className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">
                          {workspace.name}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {workspace.storageMode === "local"
                            ? t("workspace.localTitle")
                            : t("workspace.cloudTitle")}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <ModeCard
              active={mode === "local"}
              icon={HardDrive}
              title={t("workspace.localTitle")}
              onClick={() => setMode("local")}
            />
            <ModeCard
              active={mode === "cloud"}
              icon={Cloud}
              title={t("workspace.cloudTitle")}
              onClick={() => setMode("cloud")}
            />
          </div>

          <div className="mt-5 rounded-lg border border-border bg-card p-4">
            <label htmlFor="workspace-name" className="text-xs font-semibold">
              {t("workspace.nameLabel")}
            </label>
            <input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
            />
          </div>
        </div>

        <footer className="flex items-center justify-end border-t border-border bg-secondary/25 px-6 py-4">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submit()} disabled={!name.trim() || submitting || loading}>
              {mode === "local" ? t("workspace.createLocal") : t("workspace.createCloud")}
              <ArrowRight />
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
});

const ModeCard = memo(function ModeCard({
  active,
  icon: Icon,
  title,
  onClick,
}: {
  active: boolean;
  icon: typeof HardDrive;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-lg border p-4 text-left transition-all hover:-translate-y-px hover:shadow-sm",
        active ? "border-primary bg-accent/60 ring-1 ring-primary/20" : "border-border bg-card",
      )}
      onClick={onClick}
    >
      <span className="grid size-9 place-items-center rounded-lg bg-secondary">
        <Icon className="size-4 text-primary" />
      </span>
      <span className="mt-3 block text-sm font-semibold">{title}</span>
    </button>
  );
});
