import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `npm run dev:tunnel` serves the app from a random Cloudflare quick-tunnel host.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // A stray package-lock.json in the home directory otherwise confuses root detection.
  turbopack: { root: process.cwd() },
  // Don't generate AGENTS.md for AI coding agents on `next dev`.
  agentRules: false,
};

export default nextConfig;
