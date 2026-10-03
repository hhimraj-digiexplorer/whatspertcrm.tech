/**
 * Ask the server to push queued CRM updates now (after a deal edit),
 * instead of waiting for the cron. Fire-and-forget; harmless when the
 * account has no CRM connected.
 */
export function requestCrmSync(): void {
  void fetch("/api/integrations/real-expert/sync", { method: "POST" }).catch(() => {});
}
