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
  | { kind: "redirecting" }
  | { kind: "failed"; message: string };

const REDIRECT_KEY = "whatspert:es-redirect";

/**
 * Phones and tablets. Chrome on Android opens the SDK's popup as a new
 * tab that can stall on about:blank and close (seen in the field), so
 * these devices use Meta's same-tab OAuth redirect instead.
 */
function prefersRedirectFlow(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  return window.matchMedia?.("(pointer: coarse)").matches === true && window.innerWidth < 1024;
}

function redirectUri(): string {
  return `${window.location.origin}/whatsapp`;
}

function extras(coexistence: boolean) {
  return {
    setup: {},
    sessionInfoVersion: "3",
    ...(coexistence ? { featureType: "whatsapp_business_app_onboarding" } : {}),
  };
}

async function finishOnServer(payload: Record<string, unknown>): Promise<SignupResult> {
  const res = await fetch("/api/whatsapp/embedded-signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { kind: "failed", message: body.error ?? "" };
  return { kind: "connected", registrationError: body.registration_error ?? null };
}

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

  // Load the SDK up front so FB.login runs inside the click itself
  // (a popup opened after an await can be blocked or stall).
  useEffect(() => {
    if (configured && !prefersRedirectFlow()) loadSdk(appId).catch(() => undefined);
  }, [appId, configured]);

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
      if (prefersRedirectFlow()) {
        const state = crypto.randomUUID();
        try {
          sessionStorage.setItem(REDIRECT_KEY, JSON.stringify({ state, coexistence: opts.coexistence }));
        } catch {
          return { kind: "failed", message: "Please allow site storage in your browser and try again." };
        }
        const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
        url.searchParams.set("client_id", appId);
        url.searchParams.set("config_id", configId);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("override_default_response_type", "true");
        url.searchParams.set("redirect_uri", redirectUri());
        url.searchParams.set("state", state);
        url.searchParams.set("display", "touch");
        url.searchParams.set("extras", JSON.stringify(extras(opts.coexistence)));
        setBusy(true);
        window.location.assign(url.toString());
        return { kind: "redirecting" };
      }
      setBusy(true);
      finishRef.current = null;
      try {
        const FB = await loadSdk(appId);
        const code = await new Promise<string | null>((resolve) => {
          FB.login((resp) => resolve(resp.authResponse?.code ?? null), {
            config_id: configId,
            response_type: "code",
            override_default_response_type: true,
            extras: extras(opts.coexistence),
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

        return await finishOnServer({
          code,
          phone_number_id: evt.phoneNumberId,
          waba_id: evt.wabaId,
          coexistence: evt.coexistence || opts.coexistence,
        });
      } catch (err) {
        return { kind: "failed", message: err instanceof Error ? err.message : "" };
      } finally {
        setBusy(false);
      }
    },
    [appId, configId, configured],
  );

  /**
   * Back from Meta's redirect (phones): /whatsapp?code=…&state=… or
   * ?error=…. Returns null when the URL isn't a signup return.
   */
  const completeRedirect = useCallback(async (): Promise<SignupResult | null> => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error") || params.get("error_reason");
    if (!code && !error) return null;
    let saved: { state?: string; coexistence?: boolean } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(REDIRECT_KEY) || "null");
      sessionStorage.removeItem(REDIRECT_KEY);
    } catch {
      saved = null;
    }
    window.history.replaceState(null, "", window.location.pathname);
    if (error) return { kind: "cancelled" };
    if (!saved || !state || saved.state !== state) {
      return { kind: "failed", message: "The signup link expired. Please tap Connect with Facebook again." };
    }
    setBusy(true);
    try {
      return await finishOnServer({ code, redirect_uri: redirectUri(), coexistence: saved.coexistence === true });
    } catch (err) {
      return { kind: "failed", message: err instanceof Error ? err.message : "" };
    } finally {
      setBusy(false);
    }
  }, []);

  return { configured, busy, start, completeRedirect };
}
