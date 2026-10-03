"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseEmbeddedSignupMessage, type EmbeddedSignupEvent } from "@/lib/whatsapp/embedded-signup-message";

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const GRAPH_VERSION = "v21.0";

interface FacebookSdk {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(
    cb: (resp: { authResponse?: { code?: string } | null; status?: string }) => void,
    opts: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<FacebookSdk> | null = null;

function loadSdk(appId: string): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  sdkPromise ??= new Promise<FacebookSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      resolve(window.FB!);
    };
    const el = document.createElement("script");
    el.src = SDK_SRC;
    el.async = true;
    el.defer = true;
    el.crossOrigin = "anonymous";
    el.onerror = () => {
      sdkPromise = null;
      reject(new Error("Could not load the Facebook SDK"));
    };
    document.body.appendChild(el);
  });
  return sdkPromise;
}

export type SignupResult =
  | { kind: "connected"; registrationError: string | null }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

/**
 * Runs Meta's Embedded Signup popup and finishes the connection on our
 * server. The popup reports the new WABA / number through postMessage
 * and returns a one-time `code` through the login callback; they can
 * arrive in either order, so both are collected before calling the API.
 */
export function useEmbeddedSignup() {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
  const configId = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID ?? "";
  const configured = Boolean(appId && configId);
  const [busy, setBusy] = useState(false);
  const finishRef = useRef<EmbeddedSignupEvent | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const evt = parseEmbeddedSignupMessage(e.origin, e.data);
      if (evt) finishRef.current = evt;
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const start = useCallback(
    async (opts: { coexistence: boolean }): Promise<SignupResult> => {
      if (!configured) return { kind: "failed", message: "not_configured" };
      setBusy(true);
      finishRef.current = null;
      try {
        const FB = await loadSdk(appId);
        const code = await new Promise<string | null>((resolve) => {
          FB.login((resp) => resolve(resp.authResponse?.code ?? null), {
            config_id: configId,
            response_type: "code",
            override_default_response_type: true,
            extras: {
              setup: {},
              sessionInfoVersion: "3",
              ...(opts.coexistence ? { featureType: "whatsapp_business_app_onboarding" } : {}),
            },
          });
        });

        // The FINISH message can land just after the login callback.
        for (let i = 0; i < 20 && !finishRef.current; i++) {
          await new Promise((r) => setTimeout(r, 150));
        }
        const evt = finishRef.current as EmbeddedSignupEvent | null;
        if (!code || !evt || evt.type === "cancel") return { kind: "cancelled" };
        if (evt.type === "error") return { kind: "failed", message: evt.message ?? "" };
        if (evt.type !== "finish") {
          return { kind: "failed", message: "no_phone_number" };
        }

        const res = await fetch("/api/whatsapp/embedded-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            phone_number_id: evt.phoneNumberId,
            waba_id: evt.wabaId,
            coexistence: evt.coexistence || opts.coexistence,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { kind: "failed", message: body.error ?? "" };
        return { kind: "connected", registrationError: body.registration_error ?? null };
      } catch (err) {
        return { kind: "failed", message: err instanceof Error ? err.message : "" };
      } finally {
        setBusy(false);
      }
    },
    [appId, configId, configured],
  );

  return { configured, busy, start };
}
