/** Creates and encrypts the packaged Convex root credentials with Electron safeStorage. */

const { generateKeyPairSync, randomBytes } = require("node:crypto");
const { atomicWritePrivateFile, readSmallFileNoFollow } = require("./desktop-private-files.cjs");

const credentialStoreVersion = 1;
const maximumCredentialFileBytes = 256 * 1_024;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSecureStorageAvailable(safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure operating-system storage is required for the local data service.");
  }
  if (
    process.platform === "linux" &&
    typeof safeStorage.getSelectedStorageBackend === "function" &&
    safeStorage.getSelectedStorageBackend() === "basic_text"
  ) {
    throw new Error("The selected operating-system credential store is not secure.");
  }
}

function validateCredentials(value) {
  if (
    !isRecord(value) ||
    value.version !== credentialStoreVersion ||
    typeof value.instanceSecret !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.instanceSecret) ||
    typeof value.betterAuthSecret !== "string" ||
    value.betterAuthSecret.length < 32 ||
    typeof value.attestationPublicKey !== "string" ||
    value.attestationPublicKey.length < 32 ||
    typeof value.attestationPrivateKey !== "string" ||
    value.attestationPrivateKey.length < 32
  ) {
    throw new Error("Local data-service credentials have an unsupported format.");
  }
  return value;
}

function generateCredentials() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    version: credentialStoreVersion,
    instanceSecret: randomBytes(32).toString("hex"),
    betterAuthSecret: randomBytes(48).toString("base64url"),
    attestationPublicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    attestationPrivateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

function loadOrCreateCredentials({ filePath, safeStorage }) {
  assertSecureStorageAvailable(safeStorage);
  try {
    const encodedStore = readSmallFileNoFollow(
      filePath,
      "Local data-service credential store",
      maximumCredentialFileBytes,
    );
    const parsed = JSON.parse(encodedStore);
    if (
      !isRecord(parsed) ||
      parsed.version !== credentialStoreVersion ||
      typeof parsed.ciphertext !== "string"
    ) {
      throw new Error("Local data-service credential store has an unsupported format.");
    }
    const encrypted = Buffer.from(parsed.ciphertext, "base64");
    if (encrypted.length === 0 || encrypted.toString("base64") !== parsed.ciphertext) {
      throw new Error("Local data-service credential ciphertext is invalid.");
    }
    return validateCredentials(JSON.parse(safeStorage.decryptString(encrypted)));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const credentials = generateCredentials();
  const encrypted = safeStorage.encryptString(JSON.stringify(credentials)).toString("base64");
  atomicWritePrivateFile(
    filePath,
    `${JSON.stringify({ version: credentialStoreVersion, ciphertext: encrypted })}\n`,
  );
  return credentials;
}

module.exports = { loadOrCreateCredentials };
