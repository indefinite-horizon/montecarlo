/** Provider/model routing and endpoint policy at the browser/runtime boundary. */

import { expect, type Page, test } from "@playwright/test";
import { installRuntimeMock, type RuntimeMock } from "../helpers/runtime";
import { createWorkspace, openFreshUser, sendMessage } from "../helpers/workspace";

let runtime: RuntimeMock;

test.beforeEach(async ({ context, page }) => {
  runtime = await installRuntimeMock(context);
  await openFreshUser(page, "providers");
  await createWorkspace(page, `Provider workspace ${Date.now()}`);
});

async function openProviderMenu(page: Page) {
  await page.getByTestId("provider-trigger").click();
  await expect(page.getByText("Choose a provider", { exact: true })).toBeVisible();
}

async function selectProvider(page: Page, name: string, model: string) {
  await openProviderMenu(page);
  await page
    .getByTestId("provider-menu")
    .getByRole("button", { name: new RegExp(`^${name}`, "u") })
    .click();
  await openProviderMenu(page);
  await page.getByLabel("Model ID").fill(model);
  await page.getByRole("heading", { name: "New conversation" }).click();
}

function providerCard(page: Page, name: string) {
  return page.getByRole("article").filter({ has: page.getByRole("heading", { name }) });
}

test("selected provider and model control each new run without rewriting prior attribution", async ({
  page,
}) => {
  const cases = [
    ["Codex", "codex", "e2e-codex"],
    ["Ollama", "ollama", "e2e-ollama"],
    ["OpenRouter", "openrouter", "e2e/openrouter"],
    ["Claude", "anthropic", "e2e-claude"],
  ] as const;

  for (const [label, provider, model] of cases) {
    await selectProvider(page, label, model);
    await sendMessage(page, `Prompt for ${provider}`, `Stub response: Prompt for ${provider}`);
  }

  expect(runtime.chatRequests.map(({ provider, model }) => ({ provider, model }))).toEqual(
    cases.map(([, provider, model]) => ({ provider, model })),
  );
  for (const [, , model] of cases) {
    await expect(page.getByText(model, { exact: true })).toBeVisible();
  }
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
  await expect(page.getByRole("status")).toContainText("valid, policy-compliant");

  const ollama = providerCard(page, "Ollama");
  await ollama.getByLabel("Provider endpoint").fill("http://192.168.1.10:11434/v1");
  await ollama.getByRole("button", { name: "Save endpoint" }).click();
  await expect(page.getByRole("status")).toContainText("valid, policy-compliant");

  await openrouter.getByLabel("Provider endpoint").fill("https://user:secret@example.test/v1");
  await openrouter.getByRole("button", { name: "Save endpoint" }).click();
  await expect(
    page.evaluate(() => localStorage.getItem("monte-carlo:provider:openrouter:base-url")),
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
});

test("web settings never persist an OpenRouter key in renderer storage", async ({ page }) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  const openrouter = providerCard(page, "OpenRouter");
  await openrouter.getByRole("button", { name: "Add key" }).click();
  await openrouter.getByLabel("Paste API key").fill("e2e-secret-must-not-persist");
  await openrouter.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Electron app");
  const storedValues = await page.evaluate(() => Object.values(localStorage));
  expect(storedValues.join("\n")).not.toContain("e2e-secret-must-not-persist");
});
