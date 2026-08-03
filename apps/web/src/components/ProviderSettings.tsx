/** Explains and configures provider credential modes at the local-runtime boundary. */

import {
  CheckCircle2,
  Cloud,
  Cpu,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldAlert,
  Terminal,
  X,
} from "lucide-react";
import { memo, type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMountEffect } from "@/hooks/useMountEffect";
import {
  getProviderEndpoint,
  getRuntimeProviders,
  type ProviderStatus,
  saveProviderEndpoint,
  saveProviderSecret,
  startCodexDeviceLogin,
} from "@/lib/runtimeClient";
import { Button } from "./ui/button";

export const ProviderSettings = memo(function ProviderSettings({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [busyProvider, setBusyProvider] = useState<string>();
  const [editingProvider, setEditingProvider] = useState<"openrouter" | "anthropic">();
  const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState<string>();
  const [loginOutput, setLoginOutput] = useState("");
  const [endpoints, setEndpoints] = useState(() => ({
    ollama: getProviderEndpoint("ollama") || "http://127.0.0.1:11434/v1",
    openrouter: getProviderEndpoint("openrouter") || "https://openrouter.ai/api/v1",
  }));

  const refreshProviders = useCallback(async () => {
    try {
      setProviders(await getRuntimeProviders());
      setNotice(undefined);
    } catch {
      setNotice(t("settings.runtimeUnavailable"));
    }
  }, [t]);

  useMountEffect(() => {
    void refreshProviders();
  });

  const providerStatus = (id: string) => providers.find((provider) => provider.id === id);
  const badgeFor = (id: string, fallback: string) => {
    const status = providerStatus(id)?.health.status;
    if (status === "ready") return t("settings.connected");
    if (status === "unavailable") return t("settings.unavailable");
    if (status === "needs-configuration") return t("settings.needsSetup");
    return fallback;
  };

  const connectCodex = async () => {
    setBusyProvider("codex");
    setNotice(undefined);
    setLoginOutput("");
    const controller = new AbortController();
    try {
      await startCodexDeviceLogin(controller.signal, (event) => {
        if (event.type === "output") {
          setLoginOutput((current) => `${current}${event.delta}`.slice(-4_000));
        }
        if (event.type === "status") setNotice(event.message);
        if (event.type === "error") setNotice(event.message);
      });
      await refreshProviders();
    } catch {
      setNotice(t("settings.runtimeUnavailable"));
    } finally {
      setBusyProvider(undefined);
    }
  };

  const persistSecret = async () => {
    if (!editingProvider || !secret.trim()) return;
    const provider = editingProvider;
    setBusyProvider(provider);
    setNotice(undefined);
    try {
      await saveProviderSecret(provider, secret.trim());
      setSecret("");
      setEditingProvider(undefined);
      setNotice(t("settings.keySaved"));
      await refreshProviders();
    } catch {
      setNotice(t("settings.desktopKeyOnly"));
    } finally {
      setBusyProvider(undefined);
    }
  };

  const persistEndpoint = (provider: "openrouter" | "ollama") => {
    try {
      const saved = saveProviderEndpoint(provider, endpoints[provider]);
      setEndpoints((current) => ({ ...current, [provider]: saved }));
      setNotice(t("settings.endpointSaved"));
    } catch {
      setNotice(t("settings.invalidEndpoint"));
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex justify-end bg-foreground/10 backdrop-blur-[1px]"
      role="presentation"
    >
      <button type="button" className="flex-1" onClick={onClose} aria-label={t("common.close")} />
      <section
        className="h-full w-full max-w-xl overflow-y-auto border-l border-border bg-background shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
      >
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-border bg-background/95 px-5 backdrop-blur">
          <KeyRound className="size-4 text-primary" />
          <div className="min-w-0 flex-1">
            <h2 id="provider-settings-title" className="font-display text-lg font-bold">
              {t("settings.providersTitle")}
            </h2>
            <p className="text-[11px] text-muted-foreground">{t("settings.providersSubtitle")}</p>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label={t("common.close")}>
            <X />
          </Button>
        </header>

        <div className="space-y-4 p-5">
          {notice ? (
            <p
              className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground"
              role="status"
            >
              {notice}
            </p>
          ) : null}
          <ProviderCard
            icon={Terminal}
            title={t("providers.codex.name")}
            badge={badgeFor("codex", t("settings.checking"))}
            description={t("settings.codexDescription")}
            note={providerStatus("codex")?.health.detail ?? t("settings.codexSecurity")}
            action={
              providerStatus("codex")?.health.status === "ready"
                ? t("settings.checkConnection")
                : t("settings.connect")
            }
            busy={busyProvider === "codex"}
            onAction={() => {
              if (providerStatus("codex")?.health.status === "ready") void refreshProviders();
              else void connectCodex();
            }}
            ready={providerStatus("codex")?.health.status === "ready"}
          >
            {loginOutput ? (
              <pre className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/60 p-2 text-[10px] leading-4 text-muted-foreground">
                {loginOutput}
              </pre>
            ) : null}
          </ProviderCard>
          <ProviderCard
            icon={Cpu}
            title={t("providers.ollama.name")}
            badge={badgeFor("ollama", t("settings.local"))}
            description={t("settings.ollamaDescription")}
            note={providerStatus("ollama")?.health.detail ?? "http://127.0.0.1:11434"}
            action={t("settings.testEndpoint")}
            onAction={() => void refreshProviders()}
            ready={providerStatus("ollama")?.health.status === "ready"}
          >
            <EndpointEditor
              value={endpoints.ollama}
              onChange={(value) => setEndpoints((current) => ({ ...current, ollama: value }))}
              onSave={() => persistEndpoint("ollama")}
            />
          </ProviderCard>
          <ProviderCard
            icon={Cloud}
            title={t("providers.openrouter.name")}
            badge={badgeFor("openrouter", t("settings.needsKey"))}
            description={t("settings.openrouterDescription")}
            note={t("settings.keyLocalOnly")}
            action={t("settings.addKey")}
            busy={busyProvider === "openrouter"}
            onAction={() => {
              setEditingProvider("openrouter");
              setSecret("");
            }}
            ready={providerStatus("openrouter")?.health.status === "ready"}
          >
            <EndpointEditor
              value={endpoints.openrouter}
              onChange={(value) => setEndpoints((current) => ({ ...current, openrouter: value }))}
              onSave={() => persistEndpoint("openrouter")}
            />
            {editingProvider === "openrouter" ? (
              <SecretEditor
                value={secret}
                onChange={setSecret}
                onSave={() => void persistSecret()}
                onCancel={() => setEditingProvider(undefined)}
              />
            ) : null}
          </ProviderCard>
          <ProviderCard
            icon={KeyRound}
            title={t("providers.anthropic.name")}
            badge={badgeFor("anthropic", t("settings.needsKey"))}
            description={t("settings.anthropicDescription")}
            note={t("settings.keyLocalOnly")}
            action={t("settings.addKey")}
            busy={busyProvider === "anthropic"}
            onAction={() => {
              setEditingProvider("anthropic");
              setSecret("");
            }}
            ready={providerStatus("anthropic")?.health.status === "ready"}
          >
            {editingProvider === "anthropic" ? (
              <SecretEditor
                value={secret}
                onChange={setSecret}
                onSave={() => void persistSecret()}
                onCancel={() => setEditingProvider(undefined)}
              />
            ) : null}
          </ProviderCard>

          <div className="rounded-lg border border-amber-500/35 bg-amber-500/8 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <div>
                <p className="text-xs font-semibold">{t("settings.claudePlanTitle")}</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {t("settings.claudePlanBlocked")}
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 rounded-lg border border-border bg-secondary/35 p-4">
            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-[11px] leading-5 text-muted-foreground">
              {t("settings.credentialsBoundary")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
});

const ProviderCard = memo(function ProviderCard({
  icon: Icon,
  title,
  badge,
  description,
  note,
  action,
  busy = false,
  onAction,
  ready = false,
  children,
}: {
  icon: typeof Terminal;
  title: string;
  badge: string;
  description: string;
  note: string;
  action: string;
  busy?: boolean;
  onAction: () => void;
  ready?: boolean;
  children?: ReactNode;
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary">
          <Icon className="size-4 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[9px] text-muted-foreground">
              {ready ? <CheckCircle2 className="size-2.5 text-emerald-600" /> : null}
              {badge}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <code className="min-w-0 truncate text-[10px] text-muted-foreground">{note}</code>
            <Button size="xs" variant="outline" disabled={busy} onClick={onAction}>
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {action}
            </Button>
          </div>
          {children}
        </div>
      </div>
    </article>
  );
});

const SecretEditor = memo(function SecretEditor({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex gap-2">
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("settings.keyPlaceholder")}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
        aria-label={t("settings.keyPlaceholder")}
      />
      <Button size="xs" onClick={onSave} disabled={!value.trim()}>
        {t("common.save")}
      </Button>
      <Button size="xs" variant="ghost" onClick={onCancel}>
        {t("common.cancel")}
      </Button>
    </div>
  );
});

const EndpointEditor = memo(function EndpointEditor({
  value,
  onChange,
  onSave,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex gap-2">
      <input
        type="url"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("settings.endpointPlaceholder")}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
        aria-label={t("settings.endpointPlaceholder")}
      />
      <Button size="xs" variant="outline" onClick={onSave} disabled={!value.trim()}>
        {t("settings.saveEndpoint")}
      </Button>
    </div>
  );
});
