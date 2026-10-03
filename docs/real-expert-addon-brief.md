# Brief for Real Expert CRM: the WhatsApp add-on (Whatspert)

Whatspert CRM (https://whatspertcrm.tech) is sold on its own and inside
Real Expert CRM as a **WhatsApp add-on**. Inside Real Expert, WhatsApp is
available **only when the workspace has paid for both**:

1. a Real Expert CRM plan (trials don't count), and
2. a WhatsApp plan in Whatspert (Growth or Scale; trials don't count).

Otherwise Real Expert shows WhatsApp **locked**, with an upgrade prompt
that names the missing step.

Whatspert's side is built and live on the `claude/nice-gates-gno3ea`
branch of `hhimraj-digiexplorer/whatspertcrm.tech`. The data sync already
uses Real Expert's Public API v1 (`/v1/me`, `/v1/leads`,
`/v1/leads/{id}/stage`, `/v1/leads/{id}/activities`, "Send new leads to").
What Real Expert still needs is below. A working Laravel reference for
all of it (service class, controller, views, tests) is on the
`claude/nice-gates-gno3ea` branch of `hhimraj-digiexplorer/CRM1`:
`app/Services/Whatspert/WhatspertService.php`,
`app/Http/Controllers/WhatsAppController.php`,
`resources/views/whatsapp/index.blade.php`,
`resources/views/leads/_whatsapp.blade.php`, `tests/Feature/WhatsAppAddonTest.php`.

---

## 1. Shared secret and signing

Both apps share one secret (min 32 chars, `openssl rand -hex 32`):
Whatspert `REAL_EXPERT_PARTNER_SECRET`, Real Expert e.g.
`WHATSPERT_PARTNER_SECRET`. Every server-to-server call is a JSON POST to
`https://whatspertcrm.tech/api/partner/real-expert/<action>` with:

```
Content-Type: application/json
X-Partner-Timestamp: <unix seconds>
X-Partner-Signature: hex( HMAC-SHA256( secret, "<timestamp>.<raw body>" ) )
```

Requests older/newer than 5 minutes are refused. Sign the exact bytes you
send.

Every body has `ref`: the workspace's id at Whatspert, format
`re:<real expert host>:<workspace id>`, e.g. `re:crm.digiexplorer.in:42`
(`[A-Za-z0-9_-]` for the id part, max 40).

Errors come back as `{ "error": "...", "code": "..." }`.

## 2. "Paid for CRM" in Real Expert

Real Expert needs to know whether a workspace has a **paid, current** CRM
plan (not a trial). If it has no billing yet, add it: plans, Razorpay
subscriptions, and a way for DigiExplorer staff to mark a workspace paid
by hand. Whenever that yes/no changes, call `status` (§4) at once so the
add-on locks or unlocks immediately.

## 3. Activate — `POST /link`

Shown to workspace admins once the CRM plan is paid ("Activate WhatsApp
add-on"). It creates the client's Whatspert account and connects the
sync — no manual setup.

1. Create an API key in this workspace named "Whatspert" (it is shown
   once; keep it only for this call).
2. Call:

```json
{
  "ref": "re:crm.digiexplorer.in:42",
  "tenant_name": "GSR Developers",
  "owner_email": "owner@gsr.in",
  "owner_name": "Ravi Kumar",
  "crm_base_url": "https://crm.digiexplorer.in",
  "crm_api_key": "rex_live_…",
  "crm_active": true,
  "crm_plan": "Pro",
  "link_code": "K7QM-4XTB"
}
```

`link_code` is optional: an existing Whatspert customer creates one in
Whatspert → Integrations → Real Expert (valid 30 min) to link their
current account. Without it, Whatspert creates a new account for
`owner_email` — and refuses with `409 email_in_use` if that email
already has a Whatspert account (show "enter a link code").

Response:

```json
{
  "account_id": "…",
  "integration_id": "…",
  "inbound_url": "https://whatspertcrm.tech/api/integrations/real-expert/inbound/…",
  "inbound_token": "rex_…",
  "whatsapp_connected": false,
  "entitlement": { "crm_paid": true, "whatsapp_paid": false, "entitled": false, "reason": "whatsapp_unpaid", "whatsapp_plan": null }
}
```

3. Configure **Send new leads to** for this workspace with
   `inbound_url` and `inbound_token` (Bearer). Calling `link` again for the
   same `ref` is safe: it updates the key/URL and keeps the same token.

## 4. Unlocked? — `POST /status`

Body: `{ "ref", "crm_active": true|false, "crm_plan": "Pro" }`.

```json
{
  "linked": true,
  "account_id": "…",
  "whatsapp_connected": true,
  "entitlement": { "crm_paid": true, "whatsapp_paid": true, "entitled": true, "reason": null,
                   "whatsapp_plan": { "id": "growth", "name": "Growth", "status": "active" } },
  "whatsapp_plans": [ { "id": "growth", "name": "Growth", "price_monthly_inr": 1140, "price_yearly_inr": 6840, "features": [] } ]
}
```

`{ "linked": false }` if the workspace was never activated. `reason` is
`crm_unpaid`, `whatsapp_unpaid` or `null`. Cache the answer ~5 minutes;
call fresh after any CRM billing change. Treat "CRM not paid" locally as
locked regardless of the cached answer.

## 5. The WhatsApp menu

Show a **WhatsApp** item in the sidebar for everyone, with a lock icon
unless entitled. The page shows, in order:

| State | Show |
|---|---|
| CRM not paid | Step 1 — "Choose a Real Expert plan" (admins), "Ask your admin" (others) |
| Not activated | Step 2 — "Activate WhatsApp add-on" + optional link-code field |
| `whatsapp_unpaid` | Step 3 — `whatsapp_plans` with prices; "Choose a WhatsApp plan" opens Whatspert billing via SSO path `/settings?tab=billing` in a new tab; "I've paid — check again" |
| Entitled | Whatspert itself in an iframe (SSO with `embed: true`), plus "Open in new tab". First visit (`whatsapp_connected: false`): path `/whatsapp` to connect the number |

### Single sign-on link

```
https://whatspertcrm.tech/api/partner/real-expert/sso?t=<part>.<sig>
part = base64url( JSON {
  "ref", "email", "name",
  "role": "admin" | "agent",      // workspace admins → admin, everyone else → agent
  "path": "/inbox",               // relative path in Whatspert
  "embed": true,                  // true inside the iframe
  "exp": <unix seconds, now + 120> // max now + 600
} )   (no padding)
sig  = hex( HMAC-SHA256( secret, "sso." + part ) )
```

Mint a fresh link on each page view; never store it. Whatspert creates
the user on first visit (as a member of the linked account) and never
moves a user who belongs to another Whatspert account. When locked,
Whatspert only lets admins reach `/settings…` and `/whatsapp…` (to pay
and connect the number).

**Iframe:** add Whatspert's origin to Real Expert's CSP `frame-src`;
Whatspert must list Real Expert in `PARTNER_FRAME_ANCESTORS`. Safari
blocks embedded logins — keep the "Open in new tab" button.

## 6. WhatsApp on the lead page

A card on each lead with a phone number. Locked → short upsell with
"Unlock WhatsApp". Entitled → chat, reply and templates via:

`POST /chat` — `{ "ref", "phone": "+919876543210", "limit": 50 }`

```json
{ "phone": "+919876543210", "whatsapp_connected": true,
  "contact": { "id": "…", "name": "Asha" } , "conversation_id": "…",
  "window_open": true,
  "messages": [ { "id": "…", "sender_type": "customer|agent|bot", "content_type": "text",
                  "content_text": "Hi", "media_url": null, "template_name": null,
                  "status": "delivered", "created_at": "…" } ],
  "templates": [ { "name": "site_visit", "language": "en", "body_text": "Hi {{1}} …", "category": "Marketing" } ] }
```

`POST /send` — `{ "ref", "lead_id": "<real expert lead id>", "phone", "name",
"text": "…" }` or `{ …, "template": { "name", "language", "variables": ["Asha"] } }`
→ `{ "message_id", "whatsapp_message_id", "conversation_id" }`.

Free text only when `window_open` (24h after the lead last wrote);
otherwise offer templates (prefill `{{1}}` with the first name). Block
Do-Not-Contact leads before calling. Always send `lead_id` so the
contact is linked to this lead and not pushed back as a new one.

`403` with `code: "crm_unpaid" | "whatsapp_unpaid"` means locked.

## 7. Deactivate — `POST /unlink`

Body `{ "ref" }`. Stops the sync; the client's Whatspert account and
chats are kept. Also remove the "Send new leads to" target and revoke
the "Whatspert" API key.

## Checklist

- [ ] Shared secret in both `.env` files
- [ ] CRM billing with a "paid now" check; `status` call on every change
- [ ] Activate (link) → API key + Send-new-leads-to configured
- [ ] WhatsApp sidebar item with lock; WhatsApp page with the 4 states
- [ ] SSO iframe + new-tab link; CSP `frame-src` for whatspertcrm.tech
- [ ] Lead-page WhatsApp card (chat / send / templates, DNC respected)
- [ ] Deactivate (unlink)
