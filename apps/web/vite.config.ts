/** Configures Vite, React Compiler, Tailwind, and TanStack Router generation. */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../..");

function readGitRefLabel(): string {
  const explicitLabel = process.env.VITE_DEV_GIT_BRANCH?.trim();
  if (explicitLabel) return explicitLabel;

  for (const args of [
    ["branch", "--show-current"],
    ["rev-parse", "--short", "HEAD"],
  ]) {
    try {
      const label = execFileSync("git", args, {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (label) return label;
    } catch {
      // Git metadata is optional for packaged templates and downloaded zips.
    }
  }

  return "";
}

function readReleaseChannel(): string {
  return (process.env.VITE_APP_RELEASE_CHANNEL || process.env.VERCEL_ENV || "")
    .trim()
    .toLowerCase();
}

function faviconHrefForEnvironment(command: string): string {
  if (command === "serve") return "/favicon-dev.svg";
  if (readReleaseChannel() === "preview") return "/favicon-preview.svg";
  return "/favicon.svg";
}

// Workaround: @rolldown/plugin-babel PluginOptions inherits from @babel/core
// InputOptions which may expose required fields depending on the installed
// @types/babel__core version. Casting through unknown keeps the call safe.
const babelOpts = {
  presets: [reactCompilerPreset({ target: "18" })],
} as Parameters<typeof babel>[0];

export default defineConfig(({ command }) => {
  const devGitRefLabel = command === "serve" ? readGitRefLabel() : "";
  const faviconHref = faviconHrefForEnvironment(command);
  if (devGitRefLabel) {
    process.env.VITE_DEV_GIT_BRANCH = devGitRefLabel;
  }

  return {
    envPrefix: ["VITE_", "CONVEX_SITE_URL"],
    plugins: [
      {
        name: "montecarlo:favicon-href",
        transformIndexHtml(html) {
          return html.replace("%APP_FAVICON_HREF%", faviconHref);
        },
      },
      TanStackRouterVite({
        routesDirectory: path.resolve(__dirname, "src/routes"),
        generatedRouteTree: path.resolve(__dirname, "src/routeTree.gen.ts"),
        quoteStyle: "double",
      }),
      tailwindcss(),
      react(),
      babel(babelOpts),
    ],
    resolve: {
      dedupe: ["react", "react-dom", "react/jsx-runtime", "convex"],
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@montecarlo/app-constants": path.resolve(
          workspaceRoot,
          "components/app-constants/index.js",
        ),
      },
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
    },
    envDir: workspaceRoot,
    server: {
      host: true,
      port: 5173,
    },
  };
});
