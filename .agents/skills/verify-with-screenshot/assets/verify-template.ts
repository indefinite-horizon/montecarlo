import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

// Prefer repo-native helpers if they exist.
// Example:
// import { createProvisionedPage, provisionWorkspace } from "../tests/e2e/helpers/provision";

function slugTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
}

async function main() {
  const appBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
  const outDir = join(process.cwd(), ".dev", "screenshots", `${slugTimestamp()}_verify-change`);
  mkdirSync(outDir, { recursive: true });

  // TODO: Replace this with repo-specific auth/fixture setup.
  // const provisioned = await provisionWorkspace({ scope: "verify", label: "screenshots" });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.setViewportSize({ width: 1440, height: 1600 });

    // TODO: Replace with full URLs and the exact pages/selectors you need.
    await page.goto(`${appBaseUrl}/`);

    await page.screenshot({
      path: join(outDir, "01_example.png"),
      fullPage: true,
    });

    const manifest = {
      outDir,
      screenshots: [join(outDir, "01_example.png")],
    };
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    console.log(JSON.stringify(manifest, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

await main();
