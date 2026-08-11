/** Opt-in smoke journeys against real provider installations and credentials. */

import { expect, type Page, test } from "@playwright/test";
import { createWorkspace, openFreshUser } from "../helpers/workspace";

const externalEnabled = process.env.RUN_EXTERNAL_PROVIDER_TESTS === "true";

const providers = [
  {
    id: "codex",
    label: "Codex",
    flag: "E2E_CODEX_ENABLED",
    prompt: "Begin with CODEX_E2E_OK, then write exactly 80 words about ocean tides.",
    marker: "CODEX_E2E_OK",
    expectsIncrementalDeltas: true,
  },
  {
    id: "ollama",
    label: "Ollama",
    flag: "E2E_OLLAMA_ENABLED",
    prompt: "Reply with OLLAMA_E2E_OK.",
    marker: "OLLAMA_E2E_OK",
    expectsIncrementalDeltas: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    flag: "E2E_OPENROUTER_USER_KEY_ENABLED",
    prompt: "Reply with OPENROUTER_E2E_OK.",
    marker: "OPENROUTER_E2E_OK",
    expectsIncrementalDeltas: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    flag: "E2E_OPENROUTER_MANAGED_KEY_ENABLED",
    prompt: "Reply with OPENROUTER_MANAGED_E2E_OK.",
    marker: "OPENROUTER_MANAGED_E2E_OK",
    expectsIncrementalDeltas: false,
  },
  {
    id: "anthropic",
    label: "Claude",
    flag: "E2E_CLAUDE_SUBSCRIPTION_ENABLED",
    prompt: "Begin with CLAUDE_E2E_OK, then write exactly 80 words about ocean tides.",
    marker: "CLAUDE_E2E_OK",
    expectsIncrementalDeltas: true,
  },
] as const;

async function selectProvider(page: Page, id: (typeof providers)[number]["id"], label: string) {
  const trigger = page.getByTestId("provider-trigger");
  await trigger.click();
  const providerOption = page.getByTestId(`provider-option-${id}`);
  await expect(providerOption).toBeEnabled({ timeout: 60_000 });
  if (id === "openrouter") {
    await providerOption.click();
  } else {
    await providerOption.hover();
    const modelOption = page
      .getByTestId(`provider-models-${id}`)
      .locator('[role="menuitem"]:not([data-disabled])')
      .first();
    await expect(modelOption).toBeVisible({ timeout: 60_000 });
    await modelOption.click();
  }
  await expect(trigger).toHaveAccessibleName(new RegExp(`^${label},`, "u"));
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
    await selectProvider(page, provider.id, provider.label);
    const before = await page.getByRole("document").count();
    if (provider.expectsIncrementalDeltas) {
      await page.evaluate(() => {
        const state = window as typeof window & {
          __monteCarloStreamLengths?: number[];
          __monteCarloStreamObserver?: MutationObserver;
        };
        state.__monteCarloStreamLengths = [];
        state.__monteCarloStreamObserver = new MutationObserver(() => {
          const documents = document.querySelectorAll('[role="document"]');
          const length = documents.item(documents.length - 1)?.textContent?.length ?? 0;
          const lengths = state.__monteCarloStreamLengths;
          if (length > 0 && lengths?.at(-1) !== length) lengths?.push(length);
        });
        state.__monteCarloStreamObserver.observe(document.body, {
          characterData: true,
          childList: true,
          subtree: true,
        });
      });
    }
    await page.getByPlaceholder("Ask a follow-up or start a new direction…").fill(provider.prompt);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("document")).toHaveCount(before + 1, { timeout: 60_000 });
    await expect(page.getByRole("document").last()).toContainText(provider.marker);
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
    if (provider.expectsIncrementalDeltas) {
      const lengths = await page.evaluate(() => {
        const state = window as typeof window & {
          __monteCarloStreamLengths?: number[];
          __monteCarloStreamObserver?: MutationObserver;
        };
        state.__monteCarloStreamObserver?.disconnect();
        return state.__monteCarloStreamLengths ?? [];
      });
      expect(lengths.length).toBeGreaterThan(1);
    }
  });
}
