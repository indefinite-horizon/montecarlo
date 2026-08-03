/**
 * Vendored from i18next-resources-to-backend (MIT, Adriano Raiano).
 * Upstream: https://github.com/i18next/i18next-resources-to-backend
 *
 * Local copy avoids a third-party runtime dep for ~20 lines of glue that
 * bridges an arbitrary loader function to i18next's backend interface.
 */

type LoaderResult = Record<string, unknown> | { default: Record<string, unknown> };
type Loader = (lng: string, ns: string) => Promise<LoaderResult> | LoaderResult;

export function resourcesToBackend(loader: Loader) {
  return {
    type: "backend" as const,
    init() {},
    read(lng: string, ns: string, callback: (err: unknown, data: unknown) => void) {
      try {
        Promise.resolve(loader(lng, ns)).then(
          (mod) => callback(null, (mod as { default?: unknown })?.default ?? mod),
          (err) => callback(err, null),
        );
      } catch (err) {
        callback(err, null);
      }
    },
  };
}
