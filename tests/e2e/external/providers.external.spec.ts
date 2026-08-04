/** Opt-in smoke journeys against real provider installations and credentials. */

import { expect, type Page, test } from "@playwright/test";
import { createWorkspace, openFreshUser } from "../helpers/workspace";

const externalEnabled = process.env.RUN_EXTERNAL_PROVIDER_TESTS === "true";

const providers = [
  { label: "Codex", flag: "E2E_CODEX_ENABLED", prompt: "Reply with CODEX_E2E_OK." },
  { label: "Ollama", flag: "E2E_OLLAMA_ENABLED", prompt: "Reply with OLLAMA_E2E_OK." },
  {
    label: "OpenRouter",
    flag: "E2E_OPENROUTER_USER_KEY_ENABLED",
    prompt: "Reply with OPENROUTER_E2E_OK.",
  },
  {
    label: "OpenRouter",
    flag: "E2E_OPENROUTER_MANAGED_KEY_ENABLED",
    prompt: "Reply with OPENROUTER_MANAGED_E2E_OK.",
  },
  {
    label: "Claude",
    flag: "E2E_CLAUDE_SUBSCRIPTION_ENABLED",
    prompt: "Reply with CLAUDE_E2E_OK.",
  },
] as const;

async function selectProvider(page: Page, label: string) {
  await page.locator("header button[aria-expanded]").filter({ hasText: /.+/u }).first().click();
  await page.getByRole("button", { name: new RegExp(`^${label}`, "u") }).click();
}

for (const provider of providers) {
  test(`${provider.label} completes a real streamed response (${provider.flag})`, async ({
    page,
  }) => {
    test.skip(
      !externalEnabled || process.env[provider.flag] !== "true",
      `Set ${provider.flag}=true.`,
    );
    await openFreshUser(page, `external-${provider.flag.toLowerCase()}`);
    await createWorkspace(page, `External ${provider.flag}`);
    await selectProvider(page, provider.label);
    const before = await page.getByRole("document").count();
    await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(provider.prompt);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("document")).toHaveCount(before + 1, { timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  });
}
