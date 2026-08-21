/** Builds the narrow environment inherited by official local provider tooling. */

const localToolEnvironmentKeys = [
  "HOME",
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SSH_AUTH_SOCK",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "USERNAME",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
] as const;

export function localToolChildEnvironment(
  env: NodeJS.ProcessEnv,
  additionalKeys: ReadonlyArray<string> = [],
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {};
  for (const key of [...localToolEnvironmentKeys, ...additionalKeys]) {
    const value = env[key];
    if (value !== undefined) childEnvironment[key] = value;
  }
  return childEnvironment;
}
