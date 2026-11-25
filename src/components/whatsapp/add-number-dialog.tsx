"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, MessageSquare, PhoneCall } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AddNumberStep = "details" | "code" | "activate";

export interface AddNumberStart {
  step: AddNumberStep;
  phoneNumberId?: string;
  display?: string;
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/**
 * Add a number to the connected WhatsApp Business Account by SMS or voice
 * code: details → code → go live. Can also start at "code" (an unverified
 * number already in the account) or "activate" (a verified number that
 * isn't the one in use).
 */
export function AddNumberDialog({
  start,
  hasNumberInUse,
  canAddExtra,
  numberLimit,
  onClose,
  onDone,
}: {
  start: AddNumberStart | null;
  hasNumberInUse: boolean;
  /** The plan has room for one more number alongside the primary. */
  canAddExtra: boolean;
  numberLimit: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("WhatsAppSetup");
  const [step, setStep] = useState<AddNumberStep>("details");
  const [phoneId, setPhoneId] = useState("");
  const [display, setDisplay] = useState("");
  const [cc, setCc] = useState("91");
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [label, setLabel] = useState("");
  const [codeSentBy, setCodeSentBy] = useState<"SMS" | "VOICE" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!start) return;
    setStep(start.step);
    setPhoneId(start.phoneNumberId ?? "");
    setDisplay(start.display ?? "");
    setCode("");
    setPin("");
    setLabel("");
    setCodeSentBy(null);
    setError(null);
  }, [start]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const addNumber = () =>
    run(async () => {
      const { ok, data } = await post("/api/whatsapp/numbers", { cc, phone_number: number, verified_name: name });
      if (!ok) return setError(String(data.error ?? t("addFailed")));
      setPhoneId(String(data.id));
      setDisplay(`+${cc} ${number}`);
      setStep("code");
    });

  const sendCode = (method: "SMS" | "VOICE") =>
    run(async () => {
      const { ok, data } = await post(`/api/whatsapp/numbers/${phoneId}`, { action: "request_code", method });
      if (!ok) return setError(String(data.error ?? t("codeSendFailed")));
      setCodeSentBy(method);
      toast.success(method === "SMS" ? t("codeSentSms") : t("codeSentVoice"));
    });

  const verify = () =>
    run(async () => {
      const { ok, data } = await post(`/api/whatsapp/numbers/${phoneId}`, { action: "verify", code });
      if (!ok) return setError(String(data.error ?? t("verifyFailed")));
      toast.success(t("numberVerified"));
      setStep("activate");
    });

  const activate = () =>
    run(async () => {
      const { ok, data } = await post(`/api/whatsapp/numbers/${phoneId}`, { action: "activate", mode: canAddExtra ? "add" : "replace", pin: pin || undefined, label: label || undefined });
      if (!ok) return setError(String(data.error ?? t("activateFailed")));
      toast.success(t("numberLive"));
      onDone();
      onClose();
    });

  const stepIndex = step === "details" ? 0 : step === "code" ? 1 : 2;

  return (
    <Dialog open={start !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("addTitle")}</DialogTitle>
          <DialogDescription>{display || t("addDesc")}</DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-2 text-xs text-muted-foreground" aria-label={t("addSteps")}>
          {[t("stepDetails"), t("stepCode"), t("stepLive")].map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className={
                  i < stepIndex
                    ? "flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white"
                    : i === stepIndex
                      ? "flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
                      : "flex size-5 items-center justify-center rounded-full border border-border text-[11px]"
                }
              >
                {i < stepIndex ? <Check className="size-3" /> : i + 1}
              </span>
              <span className={i === stepIndex ? "font-medium text-foreground" : undefined}>{label}</span>
              {i < 2 && <span aria-hidden className="h-px w-4 bg-border" />}
            </li>
          ))}
        </ol>

        {step === "details" && (
          <div className="grid gap-3">
            <div className="grid grid-cols-[88px_1fr] gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="wa-cc">{t("fieldCc")}</Label>
                <Input id="wa-cc" inputMode="numeric" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="91" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wa-number">{t("fieldNumber")}</Label>
                <Input id="wa-number" inputMode="tel" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="9876543210" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wa-name">{t("fieldDisplayName")}</Label>
              <Input id="wa-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("fieldDisplayNameHint")} maxLength={75} />
              <p className="text-xs text-muted-foreground">{t("displayNameNote")}</p>
            </div>
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground">{t("numberRequirement")}</p>
          </div>
        )}

        {step === "code" && (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{t("codeIntro")}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void sendCode("SMS")}>
                <MessageSquare className="size-4" /> {codeSentBy === "SMS" ? t("resendSms") : t("sendSms")}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void sendCode("VOICE")}>
                <PhoneCall className="size-4" /> {t("sendVoice")}
              </Button>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wa-code">{t("fieldCode")}</Label>
              <Input
                id="wa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </div>
          </div>
        )}

        {step === "activate" && (
          <div className="grid gap-3">
            <p className="text-sm text-foreground">
              {canAddExtra ? t("activateAdd") : hasNumberInUse ? t("activateReplace", { limit: numberLimit }) : t("activateIntro")}
            </p>
            {canAddExtra && (
              <div className="grid gap-1.5">
                <Label htmlFor="wa-label">{t("fieldLabel")}</Label>
                <Input id="wa-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder={t("fieldLabelHint")} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="wa-pin">{t("fieldPin")}</Label>
              <Input id="wa-pin" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••••" />
              <p className="text-xs text-muted-foreground">{t("pinNote")}</p>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-foreground">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          {step === "details" && (
            <Button type="button" disabled={busy || !number || !name} onClick={() => void addNumber()}>
              {busy && <Loader2 className="size-4 animate-spin" />} {t("addContinue")}
            </Button>
          )}
          {step === "code" && (
            <Button type="button" disabled={busy || code.replace(/\D/g, "").length !== 6} onClick={() => void verify()}>
              {busy && <Loader2 className="size-4 animate-spin" />} {t("verifyCode")}
            </Button>
          )}
          {step === "activate" && (
            <Button type="button" disabled={busy} onClick={() => void activate()}>
              {busy && <Loader2 className="size-4 animate-spin" />} {t("goLive")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
