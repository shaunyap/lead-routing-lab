import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  turbopack: { root: __dirname },
  outputFileTracingIncludes: { "/": ["./policies/**/*", "./config/**/*"] },
};

export default nextConfig;
