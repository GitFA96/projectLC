"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";

declare global {
  interface Window {
    $WowheadPower?: { refreshLinks?: () => void };
  }
}

/**
 * Wowhead tooltip widget. Renders hover cards for any element carrying a
 * data-wowhead attribute. We render names/icons/colors ourselves, so all
 * link rewriting is disabled — if the script is blocked (adblock, offline)
 * the UI degrades gracefully to our own rendering.
 */
export function WowheadScripts() {
  // Config must exist before the widget script runs; injecting the script
  // from the same inline snippet guarantees the ordering.
  return (
    <Script id="wowhead-tooltips" strategy="afterInteractive">
      {`window.whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false, hide: { droppedby: false } };
(function () {
  var s = document.createElement("script");
  s.src = "https://wow.zamimg.com/js/tooltips.js";
  s.async = true;
  document.head.appendChild(s);
})();`}
    </Script>
  );
}

/**
 * The widget only scans the DOM once on load. Re-scan after SPA navigations
 * and client-side DOM swaps (tab switches, table filtering).
 */
export function WowheadRefresher() {
  const pathname = usePathname();

  useEffect(() => {
    const t = setTimeout(() => window.$WowheadPower?.refreshLinks?.(), 80);
    return () => clearTimeout(t);
  }, [pathname]);

  useEffect(() => {
    // Watch <main> (all app content), NOT document.body: the widget appends
    // its tooltip nodes directly to <body>, so a body-wide observer re-fires
    // refreshLinks() from the open tooltip's own DOM churn — which dismisses
    // the tooltip about a second into every hover.
    const root = document.querySelector("main") ?? document.body;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver((mutations) => {
      // Only rescan when nodes were added; refreshLinks itself doesn't add nodes
      // with link rewriting disabled, so this can't loop.
      if (!mutations.some((m) => m.addedNodes.length > 0)) return;
      clearTimeout(timer);
      timer = setTimeout(() => window.$WowheadPower?.refreshLinks?.(), 150);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  return null;
}
