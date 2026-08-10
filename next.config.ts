import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `next build` and `next dev` share `.next` by default, and a build run while
   * the dev server is up takes the dev server down with it — which surfaces as
   * every nested route 404ing rather than as an error anybody would connect to
   * the build. Setting NEXT_DIST_DIR sends a build somewhere else:
   *
   *   NEXT_DIST_DIR=.next-build npm run build
   *
   * Unset, everything behaves exactly as before.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
