import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {};

export default nextConfig;

// Gives `next dev` the D1 binding from wrangler.jsonc (a local SQLite copy).
initOpenNextCloudflareForDev();
