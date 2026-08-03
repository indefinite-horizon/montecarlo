/** Selects filesystem or R2 storage from runtime-only configuration. */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { runtimeDefaults } from "../config.js";
import { FilesystemObjectStore } from "./filesystem.js";
import { R2ObjectStore } from "./r2.js";
import {
  type ObjectStoreBackend,
  ObjectStoreConfigurationError,
  type ObjectStoreV1,
} from "./types.js";

type RuntimePlatform = NodeJS.Platform;

function defaultWorkspacesDirectory(
  env: NodeJS.ProcessEnv,
  platform: RuntimePlatform,
  userHome: string,
): string {
  if (platform === "darwin") {
    return join(userHome, "Library", "Application Support", "Monte Carlo", "workspaces");
  }
  if (platform === "win32") {
    const localData = env.LOCALAPPDATA?.trim() || env.APPDATA?.trim();
    return join(localData || join(userHome, "AppData", "Local"), "Monte Carlo", "workspaces");
  }
  const dataHome = env.XDG_DATA_HOME?.trim() || join(userHome, ".local", "share");
  return join(dataHome, "monte-carlo", "workspaces");
}

function requireSetting(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new ObjectStoreConfigurationError(`${name} is required when R2 storage is selected.`);
  }
  return value;
}

function createFilesystemStore(
  env: NodeJS.ProcessEnv = process.env,
  platform: RuntimePlatform = process.platform,
  userHome: string = homedir(),
): ObjectStoreV1 {
  const configuredRoot = env.MONTE_CARLO_WORKSPACES_DIR?.trim();
  return new FilesystemObjectStore({
    rootDirectory: resolve(configuredRoot || defaultWorkspacesDirectory(env, platform, userHome)),
    maxObjectBytes: runtimeDefaults.maxBlobBytes,
  });
}

function createR2Store(env: NodeJS.ProcessEnv): ObjectStoreV1 {
  return new R2ObjectStore({
    endpoint: requireSetting(env, "R2_ENDPOINT"),
    accessKeyId: requireSetting(env, "R2_ACCESS_KEY_ID"),
    secretAccessKey: requireSetting(env, "R2_SECRET_ACCESS_KEY"),
    bucket: requireSetting(env, "R2_BUCKET"),
    prefix: env.R2_PREFIX,
    maxObjectBytes: runtimeDefaults.maxBlobBytes,
  });
}

function selectedBackend(env: NodeJS.ProcessEnv): ObjectStoreBackend {
  const backend = env.MONTE_CARLO_OBJECT_STORE?.trim() || "filesystem";
  if (backend === "filesystem" || backend === "r2") return backend;
  throw new ObjectStoreConfigurationError("MONTE_CARLO_OBJECT_STORE must be filesystem or r2.");
}

/** Legacy single-store factory retained for embedded consumers. */
export function createObjectStore(
  env: NodeJS.ProcessEnv = process.env,
  platform: RuntimePlatform = process.platform,
  userHome: string = homedir(),
): ObjectStoreV1 {
  return selectedBackend(env) === "r2"
    ? createR2Store(env)
    : createFilesystemStore(env, platform, userHome);
}

/** Creates per-workspace backends so local and cloud workspaces can coexist. */
export function createObjectStores(
  env: NodeJS.ProcessEnv = process.env,
  platform: RuntimePlatform = process.platform,
  userHome: string = homedir(),
): Partial<Record<ObjectStoreBackend, ObjectStoreV1>> {
  const backend = selectedBackend(env);
  const r2Names = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
  const hasAnyR2Setting = r2Names.some((name) => Boolean(env[name]?.trim()));
  return {
    filesystem: createFilesystemStore(env, platform, userHome),
    ...(backend === "r2" || hasAnyR2Setting ? { r2: createR2Store(env) } : {}),
  };
}

export * from "./filesystem.js";
export * from "./key.js";
export * from "./r2.js";
export * from "./types.js";
