/** Reads and atomically writes small private desktop files without following symlinks. */

const { randomBytes } = require("node:crypto");
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

function assertRegularFile(stats, label, maximumBytes) {
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  if (stats.size > maximumBytes) throw new Error(`${label} is too large.`);
}

function readSmallFileNoFollow(filePath, label, maximumBytes) {
  if (process.platform === "win32") {
    const stats = lstatSync(filePath);
    assertRegularFile(stats, label, maximumBytes);
    return readFileSync(filePath, "utf8");
  }

  let descriptor;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    assertRegularFile(fstatSync(descriptor), label, maximumBytes);
    return readFileSync(descriptor, "utf8");
  } catch (error) {
    if (error?.code === "ELOOP") throw new Error(`${label} must be a regular file.`);
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function atomicWritePrivateFile(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, filePath);
    chmodSync(filePath, 0o600);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

module.exports = { atomicWritePrivateFile, readSmallFileNoFollow };
