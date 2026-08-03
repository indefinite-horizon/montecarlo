/** Tests encrypted provider-secret persistence and provider allowlisting. */

const assert = require("node:assert/strict");
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const { createProviderSecretStore, parseProviderSecretUpdate } = require("./provider-secrets.cjs");

function fakeSafeStorage() {
  return {
    decryptString: (value) =>
      Buffer.from(value)
        .toString("utf8")
        .replace(/^protected:/, ""),
    encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
    getSelectedStorageBackend: () => "kwallet",
    isEncryptionAvailable: () => true,
  };
}

describe("provider secret store", () => {
  let userDataPath;

  before(() => {
    userDataPath = mkdtempSync(path.join(os.tmpdir(), "monte-carlo-secrets-"));
  });

  after(() => {
    rmSync(userDataPath, { recursive: true, force: true });
  });

  it("persists only encrypted OpenRouter and Anthropic values", () => {
    const store = createProviderSecretStore({ safeStorage: fakeSafeStorage(), userDataPath });
    store.save({ provider: "openrouter", secret: "test-value-one" });
    store.save({ provider: "anthropic", secret: "test-value-two" });

    const fileContents = readFileSync(path.join(userDataPath, "provider-secrets.v1.json"), "utf8");
    assert.equal(fileContents.includes("test-value-one"), false);
    assert.equal(fileContents.includes("test-value-two"), false);
    assert.deepEqual(store.loadEnvironment(), {
      ANTHROPIC_API_KEY: "test-value-two",
      OPENROUTER_API_KEY: "test-value-one",
    });
  });

  it("clears a saved value and rejects every provider outside the allowlist", () => {
    const store = createProviderSecretStore({ safeStorage: fakeSafeStorage(), userDataPath });
    store.save({ provider: "openrouter", secret: "" });
    assert.equal(store.loadEnvironment().OPENROUTER_API_KEY, undefined);
    assert.throws(
      () => parseProviderSecretUpdate({ provider: "ollama", secret: "not-applicable" }),
      /Unsupported provider/,
    );
    assert.throws(
      () => parseProviderSecretUpdate({ provider: "codex", secret: "not-applicable" }),
      /Unsupported provider/,
    );
  });

  it("refuses to persist when operating-system encryption is unavailable", () => {
    const store = createProviderSecretStore({
      safeStorage: {
        ...fakeSafeStorage(),
        isEncryptionAvailable: () => false,
      },
      userDataPath,
    });
    assert.throws(() => store.save({ provider: "anthropic", secret: "test-value" }), /unavailable/);
  });

  it("rejects Electron's Linux plaintext storage fallback", () => {
    if (process.platform !== "linux") return;
    const store = createProviderSecretStore({
      safeStorage: {
        ...fakeSafeStorage(),
        getSelectedStorageBackend: () => "basic_text",
      },
      userDataPath,
    });
    assert.throws(
      () => store.save({ provider: "openrouter", secret: "test-value" }),
      /plaintext backend/,
    );
  });

  it("does not follow a credential-store symlink", () => {
    if (process.platform === "win32") return;
    const symlinkUserDataPath = path.join(userDataPath, "symlink-case");
    const outsidePath = path.join(userDataPath, "outside.json");
    mkdirSync(symlinkUserDataPath);
    writeFileSync(outsidePath, JSON.stringify({ version: 1, secrets: {} }));
    symlinkSync(outsidePath, path.join(symlinkUserDataPath, "provider-secrets.v1.json"));
    const store = createProviderSecretStore({
      safeStorage: fakeSafeStorage(),
      userDataPath: symlinkUserDataPath,
    });
    assert.deepEqual(store.loadEnvironment(), {});
    assert.throws(
      () => store.save({ provider: "anthropic", secret: "test-value" }),
      /regular file/,
    );
  });
});
