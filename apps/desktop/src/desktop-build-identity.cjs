/** Resolves the trusted desktop identity embedded by the packaging config. */

const desktopBuildIdentityConfig = Object.freeze({
  channels: Object.freeze({
    development: "development",
    production: "production",
  }),
  names: Object.freeze({
    development: "Monte Carlo (Dev)",
    production: "Monte Carlo",
  }),
});

function resolveDesktopBuildIdentity({ isPackaged, channel }) {
  if (!isPackaged) {
    return {
      appName: desktopBuildIdentityConfig.names.development,
      isDevelopmentBuild: true,
    };
  }

  if (channel === desktopBuildIdentityConfig.channels.development) {
    return {
      appName: desktopBuildIdentityConfig.names.development,
      isDevelopmentBuild: true,
    };
  }
  if (channel === desktopBuildIdentityConfig.channels.production) {
    return {
      appName: desktopBuildIdentityConfig.names.production,
      isDevelopmentBuild: false,
    };
  }

  throw new Error("The packaged desktop build channel is missing or invalid.");
}

module.exports = {
  desktopBuildIdentityConfig,
  resolveDesktopBuildIdentity,
};
