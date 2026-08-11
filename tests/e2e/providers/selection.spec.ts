/** Provider/model routing and endpoint policy at the browser/runtime boundary. */

import { expect, type Page, test } from "@playwright/test";
import { conversationRequests, installRuntimeMock, type RuntimeMock } from "../helpers/runtime";
import { createWorkspace, openFreshUser, sendMessage } from "../helpers/workspace";

let runtime: RuntimeMock;

test.beforeEach(async ({ context, page }) => {
  runtime = await installRuntimeMock(context);
  await openFreshUser(page, "providers");
  await createWorkspace(page, `Provider workspace ${Date.now()}`);
});

async function openProviderMenu(page: Page) {
  await page.getByTestId("provider-trigger").click();
  await expect(page.getByTestId("provider-menu")).toBeVisible();
}

async function selectProvider(page: Page, name: string, model: string) {
  await openProviderMenu(page);
  const providerOption = page
    .getByTestId("provider-menu")
    .getByRole("menuitem", { name: new RegExp(`^${name}`, "u") });
  const customModel = name === "OpenRouter";
  if (customModel) {
    await providerOption.click();
    await expect(page.getByTestId("provider-menu")).toHaveCount(0);
    await expect(page.getByTestId("provider-trigger")).toHaveAccessibleName(/^OpenRouter/u);
    await openProviderMenu(page);
    await page.getByTestId("edit-model-option").click();
    const dialog = page.getByRole("dialog", { name: "Edit model ID" });
    await dialog.getByLabel("Model ID").fill(model);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
  } else {
    await providerOption.hover();
    const submenu = page.getByTestId(
      `provider-models-${name === "Claude" ? "anthropic" : name.toLocaleLowerCase()}`,
    );
    await expect(submenu).toBeVisible();
    await submenu.getByRole("menuitem", { name: new RegExp(model, "iu") }).click();
  }
}

function providerCard(page: Page, name: string) {
  return page.getByRole("article").filter({ has: page.getByRole("heading", { name }) });
}

test("selected provider and model control each new run without rewriting prior attribution", async ({
  page,
}) => {
  await expect(page.getByTestId("chat-composer").getByTestId("provider-trigger")).toBeVisible();
  await expect(page.locator("header").getByTestId("provider-trigger")).toHaveCount(0);

  const cases = [
    ["Codex", "codex", "e2e-codex"],
    ["Claude", "anthropic", "e2e-claude"],
    ["Ollama", "ollama", "e2e-ollama"],
    ["OpenRouter", "openrouter", "e2e/openrouter"],
  ] as const;

  for (const [label, provider, model] of cases) {
    await selectProvider(page, label, model);
    await sendMessage(page, `Prompt for ${provider}`, `Stub response: Prompt for ${provider}`);
  }

  expect(conversationRequests(runtime).map(({ provider, model }) => ({ provider, model }))).toEqual(
    cases.map(([, provider, model]) => ({ provider, model })),
  );
  const transcript = page.getByTestId("transcript-scroller");
  for (const [, , model] of cases) {
    await expect(transcript.getByText(model, { exact: true })).toBeVisible();
  }
});

test("provider menu uses the requested order and disables providers that are not ready", async ({
  page,
}) => {
  await page.route("**/v1/providers", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        providers: [
          { ...runtimeProviderStatus("codex"), health: { status: "ready", detail: "ready" } },
          {
            ...runtimeProviderStatus("anthropic"),
            health: { status: "needs-configuration", detail: "setup" },
          },
          {
            ...runtimeProviderStatus("ollama"),
            health: { status: "unavailable", detail: "offline" },
          },
          {
            ...runtimeProviderStatus("openrouter"),
            health: { status: "needs-configuration", detail: "setup" },
          },
        ],
      }),
    }),
  );

  await openProviderMenu(page);
  const items = page.getByTestId("provider-menu").getByRole("menuitem");
  await expect(items.nth(0)).toContainText("Codex");
  await expect(items.nth(1)).toContainText("Claude");
  await expect(items.nth(2)).toContainText("Ollama");
  await expect(items.nth(3)).toContainText("OpenRouter");
  await expect(page.getByTestId("provider-option-anthropic")).toHaveAttribute("data-disabled");
  await expect(page.getByTestId("provider-option-ollama")).toHaveAttribute("data-disabled");
  await expect(page.getByTestId("provider-option-openrouter")).toHaveAttribute("data-disabled");
  await expect(page.getByTestId("manage-providers-option")).toBeEnabled();
});

test("model submenu handles discovery in progress and defaults to the first resolved model", async ({
  page,
}) => {
  let releaseCatalog: (() => void) | undefined;
  await page.route("**/v1/models", async (route) => {
    const provider = (route.request().postDataJSON() as { provider: string }).provider;
    if (provider !== "codex") {
      await route.fallback();
      return;
    }
    await new Promise<void>((resolve) => {
      releaseCatalog = resolve;
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        provider: "codex",
        models: [{ id: "first-codex-model", displayName: "First Codex Model" }],
        source: "cli",
        fetchedAt: Date.now(),
      }),
    });
  });

  await page.evaluate(() => {
    localStorage.removeItem("montecarlo:provider:codex:model-catalog");
    localStorage.removeItem("montecarlo:provider:codex:selected-model");
  });
  await page.reload();

  await openProviderMenu(page);
  await page.getByTestId("provider-option-codex").hover();
  const submenu = page.getByTestId("provider-models-codex");
  await expect(submenu).toContainText("Loading models…");
  releaseCatalog?.();
  await expect(submenu.getByText("First Codex Model", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("provider-menu")).toHaveCount(0);
  await expect(page.getByTestId("provider-trigger")).toHaveAccessibleName(/first-codex-model/u);
  await expect(page.getByTestId("fast-mode-toggle")).toHaveCount(0);
});

function runtimeProviderStatus(id: string) {
  return {
    id,
    name: id,
    auth: "none",
    available: true,
    description: "E2E override",
  };
}

test("composer controls send fast mode and thinking level with the next run", async ({ page }) => {
  const composer = page.getByTestId("chat-composer");
  await expect(page.locator("header").getByRole("button", { name: "New branch" })).toHaveCount(0);
  await expect(composer.getByRole("button", { name: "New branch" })).toBeVisible();
  const fastMode = composer.getByTestId("fast-mode-toggle");
  await expect(fastMode).toHaveAttribute("aria-pressed", "false");
  await fastMode.click();
  await expect(fastMode).toHaveAttribute("aria-pressed", "true");

  const thinking = composer.getByTestId("thinking-level-trigger");
  const indicator = thinking.getByTestId("thinking-level-indicator");
  const bars = indicator.getByTestId("thinking-level-bar");
  const activeBars = indicator.locator('[data-testid="thinking-level-bar"][data-state="active"]');
  await expect(thinking).toHaveAccessibleName(/Medium/u);
  await expect(bars).toHaveCount(5);
  await expect(activeBars).toHaveCount(2);
  await expect(indicator).toHaveAttribute("data-bar-count", "5");
  await expect(indicator).toHaveAttribute("data-active-bars", "2");
  await thinking.click();
  await expect(thinking).toHaveAccessibleName(/High/u);
  await expect(activeBars).toHaveCount(3);
  await expect(indicator).toHaveAttribute("data-active-bars", "3");
  await thinking.click();
  await expect(thinking).toHaveAccessibleName(/Extra high/u);
  await expect(indicator).toHaveAttribute("data-active-bars", "4");
  await thinking.click();
  await expect(thinking).toHaveAccessibleName(/Max/u);
  await expect(indicator).toHaveAttribute("data-active-bars", "5");
  await thinking.click();
  await expect(thinking).toHaveAccessibleName(/Off/u);
  await expect(activeBars).toHaveCount(0);
  await expect(indicator).toHaveAttribute("data-active-bars", "0");
  await thinking.click();
  await expect(thinking).toHaveAccessibleName(/Low/u);
  await expect(indicator).toHaveAttribute("data-active-bars", "1");
  await thinking.click();
  await thinking.click();
  await expect(thinking).toHaveAccessibleName(/High/u);
  await expect(indicator).toHaveAttribute("data-active-bars", "3");
  await expect(page.getByTestId("thinking-level-menu")).toHaveCount(0);
  await expect(thinking).not.toHaveAttribute("aria-haspopup");
  await expect(thinking).not.toHaveAttribute("aria-expanded");

  await sendMessage(page, "Use deliberate reasoning", "Stub response: Use deliberate reasoning");
  expect(conversationRequests(runtime).at(-1)?.options).toEqual({
    reasoningEffort: "high",
    fastMode: true,
  });

  await selectProvider(page, "Ollama", "e2e-ollama");
  await sendMessage(page, "Use another provider", "Stub response: Use another provider");
  expect(conversationRequests(runtime).at(-1)?.options).toEqual({
    reasoningEffort: "high",
    fastMode: false,
  });
});

test("thinking bars and cycle follow sparse model capabilities", async ({ page }) => {
  await page.route("**/v1/models", async (route) => {
    const provider = (route.request().postDataJSON() as { provider: string }).provider;
    if (provider !== "codex") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        provider: "codex",
        models: [
          {
            id: "e2e-codex",
            displayName: "E2E Codex",
            reasoningEfforts: ["low", "high"],
            supportsFastMode: true,
          },
        ],
        source: "cli",
        fetchedAt: Date.now(),
      }),
    });
  });
  await page.evaluate(() => {
    localStorage.removeItem("montecarlo:provider:codex:model-catalog");
  });
  await page.reload();

  const thinking = page.getByTestId("chat-composer").getByTestId("thinking-level-trigger");
  const indicator = thinking.getByTestId("thinking-level-indicator");
  const bars = indicator.getByTestId("thinking-level-bar");
  const activeBars = indicator.locator('[data-testid="thinking-level-bar"][data-state="active"]');
  await expect(thinking).toHaveAccessibleName(/Off/u);
  await expect(bars).toHaveCount(2);
  await expect(activeBars).toHaveCount(0);
  await expect(indicator).toHaveAttribute("data-bar-count", "2");
  await expect(indicator).toHaveAttribute("data-active-bars", "0");
  await thinking.click();
  await expect(thinking).toHaveAccessibleName(/Low/u);
  await expect(activeBars).toHaveCount(1);
  await expect(indicator).toHaveAttribute("data-active-bars", "1");
  await thinking.click();
  await expect(thinking).toHaveAccessibleName(/High/u);
  await expect(activeBars).toHaveCount(2);
  await expect(indicator).toHaveAttribute("data-active-bars", "2");
  await thinking.click();
  await expect(thinking).toHaveAccessibleName(/Off/u);
  await expect(indicator).toHaveAttribute("data-active-bars", "0");
  await expect(page.getByTestId("thinking-level-menu")).toHaveCount(0);
});

test("provider connection checks report their result in a toast", async ({ page }) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await providerCard(page, "Codex").getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Codex is connected.", { exact: true })).toBeVisible();
});

test("compatible custom endpoints persist locally and reach only matching providers", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  const ollama = providerCard(page, "Ollama");
  const openrouter = providerCard(page, "OpenRouter");
  await ollama.getByLabel("Provider endpoint").fill("http://localhost:11435/v1/");
  await ollama.getByRole("button", { name: "Save endpoint" }).click();
  await openrouter.getByLabel("Provider endpoint").fill("https://gateway.example.test/v1/");
  await openrouter.getByRole("button", { name: "Save endpoint" }).click();
  await page.getByRole("dialog", { name: "Models and providers" }).getByLabel("Close").click();

  await page.reload();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(providerCard(page, "Ollama").getByLabel("Provider endpoint")).toHaveValue(
    "http://localhost:11435/v1",
  );
  await expect(providerCard(page, "OpenRouter").getByLabel("Provider endpoint")).toHaveValue(
    "https://gateway.example.test/v1",
  );
});

test("unsafe or credential-bearing endpoints are rejected and never saved", async ({ page }) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  const openrouter = providerCard(page, "OpenRouter");
  await openrouter.getByLabel("Provider endpoint").fill("http://openrouter.example.test/v1");
  await openrouter.getByRole("button", { name: "Save endpoint" }).click();
  await expect(
    page.getByText("Use a valid, policy-compliant provider endpoint.", { exact: true }),
  ).toBeVisible();

  const ollama = providerCard(page, "Ollama");
  await ollama.getByLabel("Provider endpoint").fill("http://192.168.1.10:11434/v1");
  await ollama.getByRole("button", { name: "Save endpoint" }).click();
  await expect(
    page.getByText("Use a valid, policy-compliant provider endpoint.", { exact: true }).last(),
  ).toBeVisible();

  await openrouter.getByLabel("Provider endpoint").fill("https://user:secret@example.test/v1");
  await openrouter.getByRole("button", { name: "Save endpoint" }).click();
  await expect(
    page.evaluate(() => localStorage.getItem("montecarlo:provider:openrouter:base-url")),
  ).resolves.toBeNull();
});

test("unavailable runtime leaves chats readable and settings recover on retry", async ({
  page,
}) => {
  await page.route("**/v1/providers", (route) => route.abort("connectionrefused"));
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("status")).toContainText("local runtime is unavailable");
  await expect(page.getByRole("heading", { name: "Models and providers" })).toBeVisible();

  await page.unroute("**/v1/providers");
  await providerCard(page, "Ollama").getByRole("button", { name: "Test" }).click();
  await expect(providerCard(page, "Ollama")).toContainText("Connected");
  await expect(page.getByText("Ollama is connected.", { exact: true })).toBeVisible();
});

test("web settings never persist an OpenRouter key in renderer storage", async ({ page }) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  const openrouter = providerCard(page, "OpenRouter");
  await openrouter.getByRole("button", { name: "Add key" }).click();
  await openrouter.getByLabel("Paste API key").fill("e2e-secret-must-not-persist");
  await openrouter.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText(
      "Open the Electron app to save a key securely, or configure the runtime environment.",
      { exact: true },
    ),
  ).toBeVisible();
  const storedValues = await page.evaluate(() => Object.values(localStorage));
  expect(storedValues.join("\n")).not.toContain("e2e-secret-must-not-persist");
});
