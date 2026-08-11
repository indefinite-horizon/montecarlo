/** Defines Electron renderer URL, runtime port, MIME, and asset-confinement helpers. */

const { realpathSync, statSync } = require("node:fs");
const path = require("node:path");

const desktopOrigin = "app://montecarlo";
const defaultDevelopmentRendererUrl = "http://localhost:5173/";
// Keep aligned with runtimeDefaults.port in apps/runtime/src/config.ts.
const runtimeDefaultPort = 43_127;

const mimeTypes = Object.freeze({
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});

function readRuntimePort(rawValue) {
  if (rawValue === undefined || rawValue.trim() === "") return runtimeDefaultPort;
  const port = Number(rawValue);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("MONTECARLO_RUNTIME_PORT must be an integer between 0 and 65535.");
  }
  return port;
}

function parseRuntimeReadyLine(line) {
  const match =
    /^Monte Carlo runtime listening on (http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9][0-9]*))$/.exec(
      line.trim(),
    );
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port > 65_535) return null;
  return { baseUrl: match[1], port };
}

function resolveDevelopmentRendererUrl(rawValue) {
  const value = rawValue?.trim() || defaultDevelopmentRendererUrl;
  let url;
  try {
    url = new URL(value);
  } catch {
    return defaultDevelopmentRendererUrl;
  }
  const isLoopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  if (!isLoopback || !isHttp || url.username !== "" || url.password !== "") {
    return defaultDevelopmentRendererUrl;
  }
  return url.href;
}

function isAllowedExternalUrl(target) {
  try {
    const url = new URL(target);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function isAllowedRendererUrl(target, isDevelopment, developmentOrigin) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (isDevelopment) {
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.origin === developmentOrigin
    );
  }
  return (
    url.protocol === "app:" &&
    url.hostname === "montecarlo" &&
    url.username === "" &&
    url.password === "" &&
    url.port === ""
  );
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

function resolveExistingAsset(realRendererRoot, candidatePath) {
  try {
    if (!statSync(candidatePath).isFile()) return null;
    const realCandidate = realpathSync(candidatePath);
    if (!isPathInside(realRendererRoot, realCandidate)) return null;
    return realCandidate;
  } catch {
    return null;
  }
}

function mimeTypeForPath(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function resolveRendererAsset(rendererRoot, requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== "app:" ||
    url.hostname !== "montecarlo" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return null;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decodedPath.includes("\0")) return null;

  let realRendererRoot;
  try {
    realRendererRoot = realpathSync(rendererRoot);
  } catch {
    return null;
  }
  const relativeRequestPath = decodedPath.replace(/^[/\\]+/, "") || "index.html";
  const candidatePath = path.resolve(realRendererRoot, relativeRequestPath);
  if (!isPathInside(realRendererRoot, candidatePath)) return null;

  const assetPath = resolveExistingAsset(realRendererRoot, candidatePath);
  if (assetPath !== null) {
    return { filePath: assetPath, mimeType: mimeTypeForPath(assetPath) };
  }
  if (path.extname(relativeRequestPath) !== "") return null;

  const fallbackPath = resolveExistingAsset(
    realRendererRoot,
    path.join(realRendererRoot, "index.html"),
  );
  return fallbackPath === null
    ? null
    : { filePath: fallbackPath, mimeType: mimeTypeForPath(fallbackPath) };
}

module.exports = {
  defaultDevelopmentRendererUrl,
  desktopOrigin,
  isAllowedExternalUrl,
  isAllowedRendererUrl,
  mimeTypeForPath,
  parseRuntimeReadyLine,
  readRuntimePort,
  resolveDevelopmentRendererUrl,
  resolveRendererAsset,
  runtimeDefaultPort,
};
