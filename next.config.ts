import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Set the output file tracing root to the current project directory
  // This prevents warnings about multiple lockfiles in parent directories
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
