/** Screenshot helper that keeps paths predictable across Playwright projects. */

import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

export async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const fileName = `${name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}.png`;
  const outputPath = path.join(testInfo.outputDir, fileName);
  await page.screenshot({ path: outputPath, fullPage: true });
  await testInfo.attach(name, { path: outputPath, contentType: "image/png" });
}
