import type { NextConfig } from "next";

/**
 * Content Security Policy, and the two compromises in it.
 *
 * **`script-src` carries `'unsafe-inline'`.** Next injects its own inline
 * bootstrap scripts (the RSC flight payload) whose content differs per page, so
 * neither a hash list nor a static header can cover them — the only real fix is
 * a per-request nonce from middleware, which this app does not have. That is a
 * deliberate deferral rather than an oversight: the app has exactly one
 * `dangerouslySetInnerHTML` and it is our own static theme script, so every
 * piece of officer- or raider-written text — comments, guides, feedback — is
 * escaped by React on the way out. The directive still earns its place by
 * naming which *origins* may serve a script at all.
 *
 * **`style-src` carries it too**, because Next and Tailwind both inline styles.
 * Low risk and not avoidable without the same nonce.
 *
 * Everything else is tight: nothing may frame this app, nothing may be a plugin,
 * `base-uri` cannot be moved, and forms may only post to us.
 *
 * The allowed origins are the ones the browser actually reaches:
 * `wow.zamimg.com` serves the Wowhead tooltip widget and every item icon,
 * `*.wowhead.com` is what that widget queries for tooltip bodies, and
 * `cdn.discordapp.com` serves avatars. Warcraft Logs and Discord's API are
 * absent on purpose — those are called from the server, where CSP does not
 * apply. The tooltip widget degrades gracefully when blocked, so an origin
 * missing here costs hover cards rather than the page.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://wow.zamimg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://wow.zamimg.com https://cdn.discordapp.com",
  "font-src 'self' data:",
  "connect-src 'self' https://wow.zamimg.com https://*.wowhead.com",
  "upgrade-insecure-requests",
].join("; ");

/**
 * Applied in production only. Next's dev server needs `eval` and a websocket
 * for the error overlay and fast refresh, so a production-grade CSP in
 * development breaks the tooling rather than the app — and a policy everybody
 * works around is worse than none.
 *
 * `Strict-Transport-Security` is set here rather than left to the reverse proxy
 * because a self-hosting guild may not have configured one, and a header that
 * only exists when somebody remembered it is not a default. Browsers ignore it
 * over plain HTTP, so it costs nothing locally. `preload` is deliberately
 * absent: submitting a domain to the preload list is close to irreversible and
 * is the deployment's call, not this file's.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

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

  /**
   * Ship one directory instead of four.
   *
   * Without this a deploy is `.next` (~300 MB), `node_modules`, `public` and
   * `package.json`; with it, `<distDir>/standalone` is a self-contained server
   * with only the dependencies actually reached. That is the difference between
   * fitting a free tier's image limit and not.
   *
   * **Two things are not copied into it and have to be**, which is the whole
   * folklore of this option: `<distDir>/static` and `public/` (this app has no
   * `public/` today, so in practice it is the first). The Dockerfile does it;
   * a hand-rolled deploy must too, or every asset 404s while the pages render.
   */
  output: "standalone",


  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
