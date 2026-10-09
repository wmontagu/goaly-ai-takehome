import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Standalone output only for the Docker image (keeps it small). Render
  // runs plain `next start`, which doesn't support standalone output.
  output: process.env.NEXT_STANDALONE ? "standalone" : undefined,
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
