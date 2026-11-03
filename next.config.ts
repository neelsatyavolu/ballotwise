import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // CI deploys skip the build's own type check; the workflow's checks job runs tsc instead.
  typescript: { ignoreBuildErrors: process.env.SKIP_BUILD_TYPECHECK === "1" },
};

export default nextConfig;

// Gives `next dev` the D1 binding from wrangler.jsonc (a local SQLite copy).
initOpenNextCloudflareForDev();
