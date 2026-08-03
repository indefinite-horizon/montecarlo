/** Lets users create portable local or cloud workspaces. */

import { ArrowRight, Cloud, Database, FolderOpen, HardDrive, RefreshCw, X } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export const WorkspaceSetup = memo(function WorkspaceSetup({
  activeWorkspaceId,
  onClose,
  onCreate,
  onSelect,
  workspaces,
}: {
  activeWorkspaceId?: string;
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
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
              {t("workspace.setupEyebrow")}
            </p>
            <h2 id="workspace-setup-title" className="mt-1 font-display text-2xl font-bold">
              {t("workspace.setupTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("workspace.setupSubtitle")}</p>
          </div>
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
              description={t("workspace.localDescription")}
              bullets={[t("workspace.localBulletOne"), t("workspace.localBulletTwo")]}
              onClick={() => setMode("local")}
            />
            <ModeCard
              active={mode === "cloud"}
              icon={Cloud}
              title={t("workspace.cloudTitle")}
              description={t("workspace.cloudDescription")}
              bullets={[t("workspace.cloudBulletOne"), t("workspace.cloudBulletTwo")]}
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
            {mode === "local" ? (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-secondary/55 px-3 py-2 text-[11px] text-muted-foreground">
                <FolderOpen className="size-3.5 shrink-0 text-primary" />
                <code className="truncate">
                  ~/Library/Application Support/Monte Carlo/workspaces/…
                </code>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex gap-3 rounded-lg border border-primary/20 bg-accent/55 p-4">
            <RefreshCw className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-[11px] leading-5 text-muted-foreground">
              {t("workspace.portabilityNote")}
            </p>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-border bg-secondary/25 px-6 py-4">
          <span className="text-[10px] text-muted-foreground">{t("workspace.noBilling")}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void submit()} disabled={!name.trim() || submitting}>
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
  description,
  bullets,
  onClick,
}: {
  active: boolean;
  icon: typeof HardDrive;
  title: string;
  description: string;
  bullets: string[];
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
      <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">{description}</span>
      <span className="mt-3 block space-y-1 text-[10px] text-foreground/75">
        {bullets.map((bullet) => (
          <span key={bullet} className="flex gap-1.5">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
            {bullet}
          </span>
        ))}
      </span>
    </button>
  );
});
