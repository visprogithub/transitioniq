import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/source': ['./src/generated/**/*'],
  },
};

export default nextConfig;
