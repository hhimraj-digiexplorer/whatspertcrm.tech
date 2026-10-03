# DigiExplorer Real Expert CRM integration

Whatspert CRM syncs with Real Expert CRM in both directions. Each client
connects their own Real Expert workspace under **Integrations → Real
Expert CRM** with the workspace address and an API key.

| Sync | Direction | When it runs |
| --- | --- | --- |
| New WhatsApp leads | Whatspert → Real Expert | A new contact is created (first WhatsApp message, import, API) |
| Deal & stage updates | Whatspert → Real Expert | A deal is created, or its stage, status or value changes |
| Message history | Whatspert → Real Expert | Every WhatsApp message saved, inbound or outbound |
| Real Expert leads | Real Expert → Whatspert | Real Expert POSTs a new lead; we greet it with an approved template |

Each sync can be switched on or off per account.

## Sold as an add-on

Whatspert is sold on its own, and also inside Real Expert CRM as the
"WhatsApp add-on". The Real Expert integration only works when the
client has paid for **both** a Real Expert plan and a Whatspert plan
(Growth/Scale; trials don't count). Otherwise it is shown locked, with
the missing step, on both sides.

- The connection is created from Real Expert (WhatsApp → Activate), not
  in Whatspert. Real Expert calls the signed partner API
  (`/api/partner/real-expert/link|status|unlink|chat|send`) with
  `REAL_EXPERT_PARTNER_SECRET`, and Whatspert creates the account,
  connects the sync and returns the webhook address for Real Expert.
- An existing Whatspert customer links their account with a one-time
  link code from Whatspert → Integrations.
- Real Expert users open Whatspert through single sign-on
  (`/api/partner/real-expert/sso`), embedded in Real Expert or in a new
  tab. Allow the frame with `PARTNER_FRAME_ANCESTORS`.
- The paid-for-both rule is enforced in the database (sync triggers) and
  on every partner call, the inbound webhook and the sync worker.

What Real Expert needs to build for the add-on is in
`docs/real-expert-addon-brief.md`.

## How it works

- Database triggers (migration `045_crm_integrations.sql`) add a job to
  `crm_sync_queue` for every change that needs to go out.
- Jobs are pushed right after each WhatsApp message (inbound webhook and
  dashboard send), after deal edits, from **Sync now**, and by the cron
  below. Saving a message or moving a deal never waits for Real Expert.
- A failed push is retried after 1, 5, 15, 60 and 180 minutes, then
  marked failed. HTTP 4xx errors (except 408/425/429) fail straight away,
  because retrying will not fix them. The last error shows on the
  Integrations page.
- Changing the address or API key puts failed jobs back in the queue.
- Each contact is linked to one Real Expert lead (`crm_contact_links`).
  Deal and message pushes create the lead first if needed.

### Cron

Add a scheduled call every 5 minutes (Vercel Cron, cron-job.org, etc.):

```
GET https://whatspertcrm.tech/api/integrations/cron
x-cron-secret: <AUTOMATION_CRON_SECRET>
```

It uses the same secret as the automations cron.

## Real Expert API used

Whatspert follows Real Expert's **Public API v1**
(`docs/real-expert-public-api-v1.md`, base `https://crm.digiexplorer.in/api/v1`).
Paths can be changed per account under **Advanced settings**.

| Purpose | Call | Body Whatspert sends |
| --- | --- | --- |
| Test connection | `GET /v1/me` | — (shows the workspace name) |
| New lead | `POST /v1/leads` | `name`, `phone` (+91…), `email`, `company`, `source` ("WhatsApp"), `whatspert_contact_id`, `created_at` |
| Deal / stage | `POST /v1/leads/{lead_id}/stage` | `title`, `value`, `currency`, `status`, `stage: { name }`, `pipeline: { name }` (+ `expected_close_date`, `whatspert_deal_id`, `updated_at`) |
| WhatsApp message | `POST /v1/leads/{lead_id}/activities` | `type: "whatsapp_message"`, `direction`, `sender`, `message_type`, `text`, `media_url`, `template_name`, `status`, `whatsapp_message_id`, `sent_at` (+ `whatspert_message_id`) |

- The key goes in `Authorization: Bearer rex_live_…` (or `X-API-Key`).
- Every POST carries `Idempotency-Key: whatspert-<kind>-<id>`, so
  Whatspert's retries never repeat an action.
- Real Expert matches the stage **name** against its own stages; an
  unmatched name is kept as a note, so Whatspert does no mapping.
- Leads are sent with `source: "WhatsApp"`; Real Expert never sends
  those back (loop guard), and Whatspert also ignores them if it does.

## Real Expert → Whatspert: new leads

In Real Expert, **Integrations → API access → Send new leads to**: paste
the URL and token shown in Whatspert (Integrations → Real Expert), then
**Send a test**. Every new lead is POSTed:

```
POST https://whatspertcrm.tech/api/integrations/real-expert/inbound/<integration id>
Authorization: Bearer rex_…

{ "lead_id": "…", "name": "Asha Verma", "phone": "+919876543210", "email": null,
  "company": null, "source": "META", "project": "GSR Heights", "city": "Lucknow",
  "created_at": "2026-10-02T09:30:00Z" }
```

Whatspert then adds the lead as a WhatsApp contact (a number without a
country code gets +91), links it to the Real Expert lead, saves source /
project / city as a note on the contact, and sends the chosen welcome
template with `{{1}}` set to the first name. A signed
`X-Webhook-Signature` body (HMAC of the body with the token) and the
`{ event, data }` wrapper are accepted too.

Responses:

| Status | Meaning |
| --- | --- |
| 200 | `{ contact_id, conversation_id, message_sent, whatsapp_message_id }`, or `{ ignored: true }` |
| 400 | Missing or invalid phone number, or WhatsApp rejected the template (`code` says why) |
| 401 | Wrong token or signature |
| 403 | Receiving leads is switched off for this account |
| 404 | Unknown integration id |
| 429 | More than 120 requests a minute |
