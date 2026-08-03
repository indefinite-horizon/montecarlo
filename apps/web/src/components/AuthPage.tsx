/** Renders the sign-in page for magic-link and optional Google auth. */

import { ConvexHttpClient } from "convex/browser";
import { Mail } from "lucide-react";
import { type FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { api } from "../../../../convex/_generated/api";
import { sharedConfig } from "../../../../lib/config";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";

const devDefaultAuthUser = sharedConfig.dev.defaultAuthUser;
const initialEmail = import.meta.env.DEV ? devDefaultAuthUser.email : "";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-label="Google">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export const AuthPage = memo(function AuthPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [waitingForDevLink, setWaitingForDevLink] = useState(false);
  const navigatedRef = useRef(false);
  const googleEnabled = import.meta.env.VITE_AUTH_GOOGLE_ENABLED === "true";
  const googleDisabledTooltip =
    import.meta.env.DEV && !googleEnabled ? t("auth.googleDisabledTooltip") : undefined;

  const httpClient = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    const convexUrl = import.meta.env.VITE_CONVEX_URL || "http://127.0.0.1:3210";
    return new ConvexHttpClient(convexUrl);
  }, []);

  // lint-allow: no-direct-use-effect — polls dev-only magic-link storage after submit.
  useEffect(() => {
    if (!waitingForDevLink || !submittedEmail || !httpClient || navigatedRef.current) return;

    const interval = window.setInterval(async () => {
      try {
        const url = await httpClient.query(api.functions.devAuth.getDevMagicLink, {
          email: submittedEmail,
        });
        if (!url || navigatedRef.current) return;
        navigatedRef.current = true;
        window.clearInterval(interval);
        window.location.href = url;
      } catch {
        // Ignore transient local-dev polling errors while Convex catches up.
      }
    }, 500);

    return () => window.clearInterval(interval);
  }, [httpClient, submittedEmail, waitingForDevLink]);

  const submitLabel = useMemo(() => {
    if (waitingForDevLink) return t("auth.redirecting");
    if (loading) return t("auth.sending");
    return t("auth.sendMagicLink");
  }, [loading, t, waitingForDevLink]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedEmail = email.trim();
      if (!trimmedEmail) return;

      setLoading(true);
      setMagicLinkSent(false);
      setWaitingForDevLink(false);
      setSubmittedEmail(trimmedEmail);
      navigatedRef.current = false;
      try {
        const result = await authClient.signIn.magicLink({
          email: trimmedEmail,
          name: trimmedEmail === devDefaultAuthUser.email ? devDefaultAuthUser.name : undefined,
          callbackURL: `${window.location.origin}/`,
        });
        if (result.error) {
          toast.error(result.error.message ?? t("auth.magicLinkError"));
          return;
        }
        if (import.meta.env.DEV) {
          toast(t("auth.devAutoLogin"));
          setWaitingForDevLink(true);
          return;
        }
        setMagicLinkSent(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("auth.magicLinkError"));
      } finally {
        setLoading(false);
      }
    },
    [email, t],
  );

  const handleGoogleSignIn = useCallback(async () => {
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}/`,
      });
      if (result.error) toast.error(result.error.message ?? t("auth.googleError"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("auth.googleError"));
    }
  }, [t]);

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-[420px]">
        <CardHeader>
          <p className="text-sm font-medium text-muted-foreground">{t("app.name")}</p>
          <CardTitle className="text-2xl">{t("auth.signInTitle")}</CardTitle>
          <CardDescription className="leading-6">{t("auth.subtitle")}</CardDescription>
        </CardHeader>

        <CardContent>
          <div className="mb-4" title={googleDisabledTooltip}>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void handleGoogleSignIn()}
              disabled={!googleEnabled}
              data-testid="google-sign-in"
            >
              <GoogleIcon />
              {t("auth.continueWithGoogle")}
            </Button>
          </div>

          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">{t("auth.or")}</span>
            </div>
          </div>

          {magicLinkSent ? (
            <div className="space-y-4 text-center">
              <p className="text-sm leading-6 text-muted-foreground">
                {t("auth.checkEmail", { email: submittedEmail })}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setMagicLinkSent(false);
                  setSubmittedEmail("");
                }}
              >
                {t("auth.useDifferentEmail")}
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <label htmlFor="auth-email" className="block text-sm font-medium text-foreground">
                {t("auth.email")}
                <Input
                  id="auth-email"
                  className="mt-2"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  disabled={loading || waitingForDevLink}
                  required
                  data-testid="auth-email"
                />
              </label>
              <Button
                type="submit"
                className="w-full"
                disabled={loading || waitingForDevLink || !email.trim()}
                data-testid="auth-submit"
              >
                <Mail />
                {submitLabel}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
});
