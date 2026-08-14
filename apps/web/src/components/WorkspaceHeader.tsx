/** Renders workspace navigation, view controls, and global display actions. */

import {
  ChevronRight,
  Folder,
  MessageSquareText,
  Moon,
  PanelLeft,
  PanelRight,
  Settings,
  Sun,
  Workflow,
} from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme";
import type { WorkspaceView } from "@/hooks/useWorkspaceRouteSync";
import { ActionTooltip } from "./ActionTooltip";
import { Button } from "./ui/button";

type WorkspaceHeaderProps = {
  activeChatTitle?: string;
  activeProjectName?: string;
  branchMapOpen: boolean;
  branchMapShortcut: string;
  onOpenBranchMap: () => void;
  onOpenSettings: () => void;
  onOpenSidebar: () => void;
  onViewChange: (view: WorkspaceView) => void;
  sidebarShortcut: string;
  sidebarOpen: boolean;
  view: WorkspaceView;
};

export const WorkspaceHeader = memo(function WorkspaceHeader({
  activeChatTitle,
  activeProjectName,
  branchMapOpen,
  branchMapShortcut,
  onOpenBranchMap,
  onOpenSettings,
  onOpenSidebar,
  onViewChange,
  sidebarShortcut,
  sidebarOpen,
  view,
}: WorkspaceHeaderProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <header
      className="electron-titlebar z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-xl sm:px-5 [&>button]:size-9 [&>button_svg]:size-4"
      data-testid="workspace-titlebar"
    >
      {/* Keep this toggle's position synchronized with the collapse-sidebar toggle in WorkspaceSidebar. */}
      <ActionTooltip label={t("sidebar.open")} shortcut={sidebarShortcut} side="bottom">
        <Button
          className={
            sidebarOpen ? "electron-titlebar-leading md:hidden" : "electron-titlebar-leading-snug"
          }
          size="icon"
          variant="ghost"
          aria-label={t("sidebar.open")}
          aria-expanded={sidebarOpen}
          onClick={onOpenSidebar}
        >
          <PanelLeft />
        </Button>
      </ActionTooltip>
      <div
        className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-24"
        data-testid="chat-breadcrumb"
      >
        {activeProjectName ? (
          <>
            <span
              className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground"
              data-testid="chat-breadcrumb-project"
            >
              <Folder className="size-4 shrink-0" />
              <span className="truncate">{activeProjectName}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" />
          </>
        ) : null}
        <h1 className="truncate text-sm font-semibold" data-testid="chat-breadcrumb-title">
          {activeChatTitle}
        </h1>
      </div>

      <fieldset className="flex h-9 items-center rounded-lg border border-border bg-secondary/45">
        <legend className="sr-only">{t("canvas.viewMode")}</legend>
        <ActionTooltip label={t("canvas.threadView")} side="bottom">
          <Button
            className="h-9 gap-1.5 px-2 [&_svg]:size-3.5"
            size="sm"
            variant={view === "thread" ? "secondary" : "ghost"}
            aria-pressed={view === "thread"}
            aria-label={t("canvas.threadView")}
            onClick={() => onViewChange("thread")}
          >
            <MessageSquareText />
            <span className="hidden lg:inline">{t("canvas.thread")}</span>
          </Button>
        </ActionTooltip>
        <ActionTooltip label={t("canvas.canvasView")} side="bottom">
          <Button
            className="h-9 gap-1.5 px-2 [&_svg]:size-3.5"
            size="sm"
            variant={view === "canvas" ? "secondary" : "ghost"}
            aria-pressed={view === "canvas"}
            aria-label={t("canvas.canvasView")}
            onClick={() => onViewChange("canvas")}
          >
            <Workflow />
            <span className="hidden lg:inline">{t("canvas.canvas")}</span>
          </Button>
        </ActionTooltip>
      </fieldset>

      <ActionTooltip
        label={theme === "dark" ? t("home.lightTheme") : t("home.darkTheme")}
        side="bottom"
      >
        <Button
          className="hidden sm:inline-flex"
          size="icon"
          variant="ghost"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label={theme === "dark" ? t("home.lightTheme") : t("home.darkTheme")}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
      </ActionTooltip>
      <ActionTooltip label={t("settings.open")} side="bottom">
        <Button
          size="icon"
          variant="ghost"
          onClick={onOpenSettings}
          aria-label={t("settings.open")}
        >
          <Settings />
        </Button>
      </ActionTooltip>
      {!branchMapOpen ? (
        // Keep this toggle's position synchronized with the close-branch-map toggle in BranchMap.
        <ActionTooltip label={t("branch.mapTitle")} shortcut={branchMapShortcut} side="bottom">
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("branch.mapTitle")}
            aria-expanded={false}
            onClick={onOpenBranchMap}
          >
            <PanelRight />
          </Button>
        </ActionTooltip>
      ) : null}
      <span aria-hidden="true" className="electron-titlebar-trailing" />
    </header>
  );
});
