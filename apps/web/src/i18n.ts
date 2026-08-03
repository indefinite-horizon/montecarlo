/** Initializes i18next with per-language lazy loading and HMR-safe reloads. */

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import { resourcesToBackend } from "./lib/i18next-resources-backend";

// Brace-expanded glob keeps the build-time map in sync with supportedLngs and
// excludes non-locale files in this directory (e.g. .en-hashes.json).
const localeLoaders = import.meta.glob<{ default: Record<string, unknown> }>(
  "./locales/{en,fr}.json",
);

const supportedLngs = ["en", "fr"];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .use(
    resourcesToBackend((lng: string, _ns: string) => {
      const loader = localeLoaders[`./locales/${lng}.json`];
      return loader ? loader() : Promise.resolve({});
    }),
  )
  .init({
    supportedLngs,
    fallbackLng: "en",
    load: "languageOnly",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

if (import.meta.hot) {
  const swap = (lng: string) => (mod: unknown) => {
    const data = (mod as { default?: Record<string, unknown> } | undefined)?.default;
    if (!data) return;
    i18n.addResourceBundle(lng, "translation", data, true, true);
    void i18n.changeLanguage(i18n.language);
  };
  import.meta.hot.accept("./locales/en.json", swap("en"));
  import.meta.hot.accept("./locales/fr.json", swap("fr"));
  // When adding a new locale (e.g. es.json), append another accept line here.
}

export default i18n;
