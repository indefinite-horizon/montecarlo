/** Starter authenticated home page. */

import { createFileRoute } from "@tanstack/react-router";
import { Languages, LogOut, Moon, Sun } from "lucide-react";
import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTheme } from "@/hooks/useTheme";
import { authClient } from "@/lib/auth-client";

const HomePage = memo(function HomePageComponent() {
  const { t, i18n } = useTranslation();
  const { currentUserName, currentUserEmail } = useCurrentUser();
  const { theme, setTheme } = useTheme();

  const handleSignOut = useCallback(async () => {
    const result = await authClient.signOut();
    if (result.error) {
      toast.error(result.error.message ?? t("home.signOutError"));
      return;
    }
    window.location.href = "/login";
  }, [t]);

  const handleLanguageToggle = useCallback(() => {
    void i18n.changeLanguage(i18n.language.startsWith("fr") ? "en" : "fr");
  }, [i18n]);

  const handleThemeToggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  return (
    <main data-testid="home-page" className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8">
        <header className="flex items-center justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("app.name")}</p>
            <h1 className="mt-1 text-2xl font-semibold">{t("home.title")}</h1>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleSignOut()}
            data-testid="sign-out"
          >
            <LogOut />
            {t("home.signOut")}
          </Button>
        </header>

        <section className="grid flex-1 place-items-center py-12">
          <Card className="w-full max-w-2xl">
            <CardHeader>
              <p className="text-sm font-medium text-muted-foreground">{t("home.greetingLabel")}</p>
              <CardTitle className="text-3xl">
                {t("home.greeting", {
                  name: currentUserName || currentUserEmail || t("home.defaultUser"),
                })}
              </CardTitle>
              <CardDescription className="leading-6">{t("home.body")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" onClick={handleThemeToggle}>
                {theme === "dark" ? <Sun /> : <Moon />}
                {theme === "dark" ? t("home.lightTheme") : t("home.darkTheme")}
              </Button>
              <Button type="button" variant="outline" onClick={handleLanguageToggle}>
                <Languages />
                {i18n.language.startsWith("fr") ? "English" : "Francais"}
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
});

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});
