/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  webpack: (webpackConfig, { dev }) => {
    if (dev) {
      const existingIgnored = Array.isArray(webpackConfig.watchOptions?.ignored)
        ? webpackConfig.watchOptions.ignored
        : webpackConfig.watchOptions?.ignored
          ? [webpackConfig.watchOptions.ignored]
          : [];
      const normalizedIgnored = existingIgnored.filter(
        (value) => typeof value === "string" && value.trim().length > 0,
      );
      webpackConfig.watchOptions = {
        ...webpackConfig.watchOptions,
        ignored: Array.from(
          new Set([
            ...normalizedIgnored,
            "**/node_modules/**",
            "**/.git/**",
            "**/.next/**",
            "**/logs/**",
            "**/.run/**",
            "**/*.log",
          ]),
        ),
      };
    }
    return webpackConfig;
  },
};

export default config;
