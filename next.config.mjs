/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Our lib/ uses ESM-style ".js" specifiers that point at ".ts" sources (the
    // convention tsc/tsx/vitest already resolve). Teach webpack the same mapping so
    // server modules pulled into the build (auth → lib/users → lib/audit) resolve.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
