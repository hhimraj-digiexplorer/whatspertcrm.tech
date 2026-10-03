"use client";

import { useEffect, useState } from "react";

// Cached for the page's lifetime: the answer only changes when the
// server's SUPER_ADMIN_EMAILS changes.
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

function load(): Promise<boolean> {
  inflight ??= fetch("/api/admin/me", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { isSuperAdmin: false }))
    .then((b: { isSuperAdmin?: boolean }) => (cached = Boolean(b.isSuperAdmin)))
    .catch(() => false)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** null while unknown, then whether the user is a platform operator. */
export function useIsSuperAdmin(): boolean | null {
  const [value, setValue] = useState<boolean | null>(cached);
  useEffect(() => {
    if (cached !== null) return;
    let alive = true;
    void load().then((v) => alive && setValue(v));
    return () => {
      alive = false;
    };
  }, []);
  return value;
}
