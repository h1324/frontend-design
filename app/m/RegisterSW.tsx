"use client";

import { useEffect } from "react";

/** Registers the field-orders service worker so the /m shell is available offline (spec S27).
 *  No-op where service workers are unavailable. */
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // registration failures are non-fatal — the app still works online
    });
  }, []);
  return null;
}
