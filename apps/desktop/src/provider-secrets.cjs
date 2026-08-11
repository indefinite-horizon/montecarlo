/** Persists supported provider API keys through Electron safeStorage without plaintext fallback. */

const {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const providerEnvironmentNames = Object.freeze({
  openrouter: "MONTECARLO_USER_OPENROUTER_API_KEY",
});
const providerSecretStoreVersion = 1;
const maximumSecretCharacters = 8_192;
const maximumStoreBytes = 128 * 1_024;

function assertRegularCredentialFile(fileStats) {
  if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
    throw new Error("Provider credential store must be a regular file.");
  }
  if (fileStats.size > maximumStoreBytes) {
    throw new Error("Provider credential store is too large.");
  }
}

function readCredentialFile(filePath) {
  if (process.platform === "win32") {
    const fileStats = lstatSync(filePath);
    assertRegularCredentialFile(fileStats);
    return readFileSync(filePath, "utf8");
  }

  let descriptor;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    assertRegularCredentialFile(fstatSync(descriptor));
    return readFileSync(descriptor, "utf8");
  } catch (error) {
    if (error?.code === "ELOOP") {
      throw new Error("Provider credential store must be a regular file.");
    }
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSupportedProvider(provider) {
  if (!Object.hasOwn(providerEnvironmentNames, provider)) {
    throw new Error("Unsupported provider secret identifier.");
  }
}

function assertSecureStorageAvailable(safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure operating-system credential storage is unavailable.");
  }
  if (
    process.platform === "linux" &&
    typeof safeStorage.getSelectedStorageBackend === "function" &&
    safeStorage.getSelectedStorageBackend() === "basic_text"
  ) {
    throw new Error("Electron safeStorage selected an insecure plaintext backend.");
  }
}

function readEncryptedEntries(filePath) {
  let encoded;
  try {
    encoded = readCredentialFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error("Provider credential store is not valid JSON.");
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== providerSecretStoreVersion ||
    !isRecord(parsed.secrets)
  ) {
    throw new Error("Provider credential store has an unsupported format.");
  }

  const entries = {};
  for (const provider of Object.keys(providerEnvironmentNames)) {
    const encrypted = parsed.secrets[provider];
    if (typeof encrypted === "string" && encrypted.length <= maximumStoreBytes) {
      entries[provider] = encrypted;
    }
  }
  return entries;
}

function writeEncryptedEntries(filePath, entries) {
  const parentDirectory = path.dirname(filePath);
  mkdirSync(parentDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ version: providerSecretStoreVersion, secrets: entries })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    renameSync(temporaryPath, filePath);
    chmodSync(filePath, 0o600);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function decodeSecret(safeStorage, encoded) {
  const encrypted = Buffer.from(encoded, "base64");
  if (encrypted.length === 0 || encrypted.toString("base64") !== encoded) {
    throw new Error("Provider credential ciphertext is invalid.");
  }
  return safeStorage.decryptString(encrypted);
}

function parseProviderSecretUpdate(value) {
  if (!isRecord(value) || typeof value.provider !== "string" || typeof value.secret !== "string") {
    throw new Error("Provider secret update must contain a provider and secret.");
  }
  assertSupportedProvider(value.provider);
  const secret = value.secret.trim();
  if (secret.length > maximumSecretCharacters) {
    throw new Error("Provider secret exceeds the supported length.");
  }
  return { provider: value.provider, secret };
}

function createProviderSecretStore({ safeStorage, userDataPath }) {
  const filePath = path.join(userDataPath, "provider-secrets.v1.json");

  return Object.freeze({
    loadEnvironment() {
      let entries;
      try {
        entries = readEncryptedEntries(filePath);
      } catch {
        return {};
      }
      if (Object.keys(entries).length === 0) return {};
      try {
        assertSecureStorageAvailable(safeStorage);
      } catch {
        return {};
      }

      const environment = {};
      for (const [provider, environmentName] of Object.entries(providerEnvironmentNames)) {
        const encoded = entries[provider];
        if (encoded === undefined) continue;
        try {
          const secret = decodeSecret(safeStorage, encoded);
          if (secret !== "") environment[environmentName] = secret;
        } catch {
          // A corrupt credential is ignored instead of weakening storage or blocking startup.
        }
      }
      return environment;
    },

    save(update) {
      assertSecureStorageAvailable(safeStorage);
      const { provider, secret } = parseProviderSecretUpdate(update);
      const entries = readEncryptedEntries(filePath);
      if (secret === "") {
        Reflect.deleteProperty(entries, provider);
      } else {
        entries[provider] = safeStorage.encryptString(secret).toString("base64");
      }
      writeEncryptedEntries(filePath, entries);
    },
  });
}

module.exports = {
  createProviderSecretStore,
  parseProviderSecretUpdate,
};
