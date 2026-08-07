/** Renders an accessible, keyboard-driven command palette for application actions. */

import { Command } from "cmdk";
import { Search } from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import { ShortcutHint } from "./ActionTooltip";

export type CommandPaletteAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  keywords?: readonly string[];
  disabled?: boolean;
  dataTestId?: string;
  onSelect: () => void;
};

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: readonly CommandPaletteAction[];
  dialogLabel: string;
  searchPlaceholder: string;
  emptyMessage: string;
};

export const CommandPalette = memo(function CommandPalette(props: CommandPaletteProps) {
  if (!props.open) return null;
  return <OpenCommandPalette {...props} />;
});

function OpenCommandPalette({
  onOpenChange,
  actions,
  dialogLabel,
  searchPlaceholder,
  emptyMessage,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  return (
    <Command.Dialog
      open
      onOpenChange={onOpenChange}
      label={dialogLabel}
      loop
      data-testid="command-palette-dialog"
      overlayClassName="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      contentClassName="fixed left-1/2 top-[18%] z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          autoFocus
          aria-label={searchPlaceholder}
          data-command-palette-input="true"
          data-testid="command-palette-input"
          placeholder={searchPlaceholder}
          className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <Command.List className="max-h-80 overflow-y-auto p-2" data-testid="command-palette-list">
        <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </Command.Empty>
        {actions.map((action) => (
          <Command.Item
            key={action.id}
            value={action.id}
            keywords={[action.label, ...(action.keywords ?? [])]}
            disabled={action.disabled}
            data-testid={action.dataTestId}
            onSelect={() => {
              onOpenChange(false);
              action.onSelect();
            }}
            className="group flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            {action.icon ? (
              <span
                className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4"
                aria-hidden="true"
              >
                {action.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{action.label}</span>
            {action.shortcut ? (
              <ShortcutHint className="opacity-0 transition-opacity group-hover:opacity-100 group-data-[selected=true]:opacity-100 group-focus-visible:opacity-100">
                {action.shortcut}
              </ShortcutHint>
            ) : null}
          </Command.Item>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
