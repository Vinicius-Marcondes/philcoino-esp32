const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withAndroidCleartext(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error("AndroidManifest.xml is missing its application element.");
    }

    application.$ = application.$ ?? {};
    application.$["android:usesCleartextTraffic"] = "true";
    return config;
  });
};
