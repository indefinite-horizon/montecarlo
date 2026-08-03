/** Friendly full-screen error fallback shown when a route or the app throws. */

import { useNavigate } from "@tanstack/react-router";
import { Home, RefreshCw } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ErrorScreenProps = {
  error?: unknown;
  onReturn?: () => void;
};

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

export const ErrorScreen = memo(function ErrorScreen({ error, onReturn }: ErrorScreenProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);
  const details = error !== undefined ? formatError(error) : null;

  const handleReturn = useCallback(() => {
    if (onReturn) {
      onReturn();
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [navigate, onReturn]);

  return (
    <div
      data-testid="error-screen"
      className="grid min-h-screen place-items-center bg-background p-6"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            {t("errorScreen.eyebrow")}
          </p>
          <CardTitle className="text-2xl">{t("errorScreen.headline")}</CardTitle>
          <CardDescription className="leading-6">{t("errorScreen.subcopy")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Button type="button" onClick={handleReturn}>
              <Home />
              {t("errorScreen.returnHome")}
            </Button>
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              <RefreshCw />
              {t("errorScreen.tryAgain")}
            </Button>
          </div>
          {details && (
            <div className="mt-6">
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => setShowDetails((value) => !value)}
              >
                {showDetails ? t("errorScreen.hideDetails") : t("errorScreen.showDetails")}
              </button>
              {showDetails && (
                <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  {details}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
