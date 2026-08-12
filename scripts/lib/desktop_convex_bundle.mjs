import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export const REPOSITORY_ROOT = resolve(moduleDirectory, "../..");
export const CONVEX_BUNDLE_TEMPLATE = join(REPOSITORY_ROOT, "apps/desktop/convex-bundle");
export const DEFAULT_OUTPUT_DIRECTORY = join(REPOSITORY_ROOT, ".desktop-resources/convex");
export const DEFAULT_CACHE_DIRECTORY = join(REPOSITORY_ROOT, ".dev/desktop-convex-cache");
const DESKTOP_RELEASE_POLICY = join(REPOSITORY_ROOT, "apps/desktop/release-compatibility.json");

const SOURCE_PATHS = ["convex", "lib/config.ts", "lib/analytics/sanitize.ts"];
const APP_CONSTANTS_FILES = ["package.json", "index.js", "index.cjs", "index.d.ts"];
const ESBUILD_NATIVE_PACKAGES = {
  "darwin-arm64": "@esbuild/darwin-arm64",
  "darwin-x64": "@esbuild/darwin-x64",
  "linux-arm64": "@esbuild/linux-arm64",
  "linux-x64": "@esbuild/linux-x64",
  "windows-x64": "@esbuild/win32-x64",
};

function assertChildPath(parent, child, label) {
  const pathFromParent = relative(resolve(parent), resolve(child));
  if (pathFromParent === "" || pathFromParent.startsWith(`..${sep}`) || pathFromParent === "..") {
    throw new Error(`${label} must be a child of ${parent}`);
  }
}

export function normalizeTargets(
  requestedTargets,
  host = { platform: process.platform, arch: process.arch },
) {
  const requested = requestedTargets.length === 0 ? ["host"] : requestedTargets;
  const normalized = new Set();

  for (const target of requested) {
    if (target === "host") {
      const platform = host.platform === "win32" ? "windows" : host.platform;
      normalized.add(`${platform}-${host.arch}`);
      continue;
    }
    if (target === "mac-universal") {
      normalized.add("darwin-arm64");
      normalized.add("darwin-x64");
      continue;
    }
    normalized.add(target);
  }

  return [...normalized].sort();
}

export function validateBackendManifest(manifest, targets) {
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported Convex backend manifest schema: ${manifest.schemaVersion}`);
  }
  if (!/^precompiled-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]+$/.test(manifest.release)) {
    throw new Error(
      `Convex backend release is not an immutable precompiled tag: ${manifest.release}`,
    );
  }
  if (!manifest.baseUrl.endsWith(`/${manifest.release}`)) {
    throw new Error("Convex backend base URL and release tag do not match");
  }

  const shaPattern = /^[0-9a-f]{64}$/;
  if (!shaPattern.test(manifest.license?.sha256 ?? "")) {
    throw new Error("Convex backend license is missing a SHA-256 digest");
  }

  for (const target of targets) {
    const asset = manifest.targets[target];
    if (!asset) {
      throw new Error(`No pinned Convex backend binary is available for ${target}`);
    }
    if (!shaPattern.test(asset.sha256)) {
      throw new Error(`Convex backend binary for ${target} is missing a SHA-256 digest`);
    }
    if (!asset.archive.endsWith(".zip")) {
      throw new Error(`Convex backend asset for ${target} must be a zip archive`);
    }
  }
}

export function validateDesktopDataPolicy(policy) {
  if (
    policy?.formatVersion !== 1 ||
    !Number.isInteger(policy.dataLayoutVersion) ||
    policy.dataLayoutVersion < 1 ||
    !Number.isInteger(policy.minimumReadableDataLayoutVersion) ||
    !Array.isArray(policy.dataMigrations)
  ) {
    throw new Error("The desktop data compatibility policy is invalid");
  }
  if (
    policy.dataLayoutVersion !== policy.minimumReadableDataLayoutVersion ||
    policy.dataMigrations.length !== 0
  ) {
    throw new Error(
      "Desktop data migrations are not implemented; the packaged data format must remain immutable",
    );
  }
  return policy;
}

export async function sha256(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function download(url, destination, expectedSha256) {
  await mkdir(dirname(destination), { recursive: true });

  try {
    if ((await sha256(destination)) === expectedSha256) return;
    await unlink(destination);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const partial = `${destination}.part`;
  await unlink(partial).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error(`Download failed with HTTP ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { mode: 0o600 }));
      const actualSha256 = await sha256(partial);
      if (actualSha256 !== expectedSha256) {
        throw new Error(`SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
      }
      await rename(partial, destination);
      return;
    } catch (error) {
      lastError = error;
      await unlink(partial).catch(() => {});
      if (attempt < 3) continue;
    }
  }
  throw new Error(`Unable to download ${url}: ${lastError?.message ?? lastError}`);
}

async function findExecutable(directory, executableName) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findExecutable(candidate, executableName);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === executableName) {
      return candidate;
    }
  }
  return undefined;
}

async function extractBackend(archive, targetDirectory, executableName) {
  await rm(targetDirectory, { recursive: true, force: true });
  await mkdir(targetDirectory, { recursive: true });

  const result = spawnSync("unzip", ["-q", archive, "-d", targetDirectory], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`Unable to run unzip: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Unable to extract ${archive}: ${result.stderr.trim()}`);
  }

  const extractedExecutable = await findExecutable(targetDirectory, executableName);
  if (!extractedExecutable) {
    throw new Error(`${executableName} was not present in ${archive}`);
  }

  const finalExecutable = join(targetDirectory, executableName);
  if (extractedExecutable !== finalExecutable) {
    await rename(extractedExecutable, finalExecutable);
  }
  await chmod(finalExecutable, 0o755);

  for (const entry of await readdir(targetDirectory)) {
    const entryPath = join(targetDirectory, entry);
    if (entryPath !== finalExecutable) {
      await rm(entryPath, { recursive: true, force: true });
    }
  }

  return finalExecutable;
}

async function stageProject(projectDirectory, targets) {
  await mkdir(projectDirectory, { recursive: true });
  await copyFile(
    join(CONVEX_BUNDLE_TEMPLATE, "package.json"),
    join(projectDirectory, "package.json"),
  );
  await copyFile(
    join(CONVEX_BUNDLE_TEMPLATE, "package-lock.json"),
    join(projectDirectory, "package-lock.json"),
  );

  for (const sourcePath of SOURCE_PATHS) {
    const source = join(REPOSITORY_ROOT, sourcePath);
    const destination = join(projectDirectory, sourcePath);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: true });
  }

  const appConstantsDirectory = join(projectDirectory, "packages/app-constants");
  await mkdir(appConstantsDirectory, { recursive: true });
  const pinnedAppConstantsPackage = await readFile(
    join(CONVEX_BUNDLE_TEMPLATE, "packages/app-constants/package.json"),
    "utf8",
  );
  const sourceAppConstantsPackage = await readFile(
    join(REPOSITORY_ROOT, "components/app-constants/package.json"),
    "utf8",
  );
  if (pinnedAppConstantsPackage !== sourceAppConstantsPackage) {
    throw new Error(
      "Packaged app-constants metadata is stale; update convex-bundle/packages/app-constants/package.json",
    );
  }
  for (const fileName of APP_CONSTANTS_FILES) {
    await copyFile(
      join(REPOSITORY_ROOT, "components/app-constants", fileName),
      join(appConstantsDirectory, fileName),
    );
  }

  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmCache = join(DEFAULT_CACHE_DIRECTORY, "npm");
  await mkdir(npmCache, { recursive: true });
  const install = spawnSync(
    npmExecutable,
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: npmCache },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (install.error) {
    throw new Error(
      `Unable to run npm ci for the packaged Convex project: ${install.error.message}`,
    );
  }
  if (install.status !== 0) {
    throw new Error(`Unable to install packaged Convex dependencies:\n${install.stderr.trim()}`);
  }

  // npm installs only the native esbuild package for the build machine. A
  // universal app must carry the package for every target architecture that
  // can execute this deployment project after installation.
  const nativeEsbuildPackages = targets.map(
    (target) => `${ESBUILD_NATIVE_PACKAGES[target]}@0.27.0`,
  );
  const nativeInstall = spawnSync(
    npmExecutable,
    [
      "install",
      "--force",
      "--no-save",
      "--package-lock=false",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...nativeEsbuildPackages,
    ],
    {
      cwd: projectDirectory,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: npmCache },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (nativeInstall.error) {
    throw new Error(`Unable to install target esbuild binaries: ${nativeInstall.error.message}`);
  }
  if (nativeInstall.status !== 0) {
    throw new Error(`Unable to install target esbuild binaries:\n${nativeInstall.stderr.trim()}`);
  }

  const installedAppConstants = join(projectDirectory, "node_modules/@montecarlo/app-constants");
  await rm(installedAppConstants, { recursive: true, force: true });
  await cp(appConstantsDirectory, installedAppConstants, { recursive: true, force: true });

  for (const target of targets) {
    const packagePath = ESBUILD_NATIVE_PACKAGES[target];
    const executableName = target.startsWith("windows-") ? "esbuild.exe" : "esbuild";
    await stat(join(projectDirectory, "node_modules", packagePath, "bin", executableName));
  }

  const cliPath = join(projectDirectory, "node_modules/convex/bin/main.js");
  await stat(cliPath);
  return cliPath;
}

export async function prepareDesktopConvexBundle({
  requestedTargets = [],
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
} = {}) {
  assertChildPath(REPOSITORY_ROOT, outputDirectory, "Convex bundle output directory");
  const targets = normalizeTargets(requestedTargets);
  const manifest = JSON.parse(
    await readFile(join(CONVEX_BUNDLE_TEMPLATE, "backend-manifest.json"), "utf8"),
  );
  const dataPolicy = validateDesktopDataPolicy(
    JSON.parse(await readFile(DESKTOP_RELEASE_POLICY, "utf8")),
  );
  validateBackendManifest(manifest, targets);

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(join(outputDirectory, "binaries"), { recursive: true });

  const licenseCache = join(DEFAULT_CACHE_DIRECTORY, manifest.release, manifest.license.file);
  await download(
    `${manifest.baseUrl}/${manifest.license.file}`,
    licenseCache,
    manifest.license.sha256,
  );
  await mkdir(join(outputDirectory, "licenses"), { recursive: true });
  await copyFile(licenseCache, join(outputDirectory, "licenses/convex-backend-LICENSE.md"));

  const binaries = {};
  const binaryDigests = {};
  const sourceArchives = {};
  for (const target of targets) {
    const asset = manifest.targets[target];
    const archive = join(DEFAULT_CACHE_DIRECTORY, manifest.release, asset.archive);
    await download(`${manifest.baseUrl}/${asset.archive}`, archive, asset.sha256);
    const executable = await extractBackend(
      archive,
      join(outputDirectory, "binaries", target),
      asset.executable,
    );
    binaries[target] = relative(outputDirectory, executable).split(sep).join("/");
    binaryDigests[target] = await sha256(executable);
    sourceArchives[target] = {
      file: asset.archive,
      sha256: asset.sha256,
    };
  }

  const cliPath = await stageProject(join(outputDirectory, "project"), targets);
  const bundleManifest = {
    schemaVersion: 1,
    backendRelease: manifest.release,
    dataFormatVersion: dataPolicy.dataLayoutVersion,
    minimumReadableDataFormatVersion: dataPolicy.minimumReadableDataLayoutVersion,
    backendRepository: manifest.repository,
    convexCliVersion: "1.39.1",
    cliEntrypoint: relative(outputDirectory, cliPath).split(sep).join("/"),
    projectDirectory: "project",
    binaries,
    binaryDigests,
    sourceArchives,
  };
  await writeFile(
    join(outputDirectory, "manifest.json"),
    `${JSON.stringify(bundleManifest, null, 2)}\n`,
    { mode: 0o644 },
  );

  return { outputDirectory, bundleManifest };
}
