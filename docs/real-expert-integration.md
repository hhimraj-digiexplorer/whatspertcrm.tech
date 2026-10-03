# DigiExplorer Real Expert CRM integration

Whatspert CRM syncs with Real Expert CRM in both directions. Each client
connects their own Real Expert workspace under **Integrations → Real
Expert CRM** with the workspace address and an API key. Real Expert is
DigiExplorer's Laravel CRM (repository `hhimraj-digiexplorer/CRM1`).

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

Real Expert's side is in the `hhimraj-digiexplorer/CRM1` repository,
`docs/whatsapp-addon.md`.

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

Whatspert talks to Real Expert's built-in REST API (`/api/v1`). Nothing
needs to change in Real Expert. Paths can be changed per account under
**Advanced settings** if an install differs.

### Setting it up in Real Expert

1. **Settings → API → Generate API key**, and switch the API on.
2. In Whatspert, **Integrations → Real Expert CRM**: enter the Real
   Expert address (e.g. `https://crm.digiexplorer.in`) and the API key,
   then **Test connection**.
3. For Real Expert leads → WhatsApp: switch it on in Whatspert, pick the
   welcome template and save. Then in Real Expert **Settings → Webhooks**
   add a webhook with the URL shown in Whatspert, paste the Whatspert
   token as the **Secret**, and tick **lead.created**.

### Calls Whatspert makes

All requests send `X-API-Key: <key>` and
`Idempotency-Key: whatspert-<kind>-<id>`.

| Purpose | Call | Body |
| --- | --- | --- |
| Test connection | `GET /api/v1/stats` | — |
| New lead | `POST /api/v1/leads` | `first_name`, `last_name`, `phone` (+91…), `email`, `source` ("WhatsApp"), `notes`, `external_id` |
| Stage list | `GET /api/v1/deals/stages` | — (fetched once per sync run) |
| First deal sync | `POST /api/v1/deals` | `lead_id`, `title`, `stage`, `contract_price`, `closing_date` |
| Later deal syncs | `PUT /api/v1/deals/{deal_id}` | `title`, `stage`, `contract_price`, `closing_date` |
| WhatsApp message | `POST /api/v1/activities` | `lead_id`, `type` ("sms"), `subject`, `body`, `logged_at` |

Notes:

- Real Expert requires a first and last name. "Asha Verma" is sent as
  Asha / Verma; a single name gets last name "-"; a contact with no name
  is sent as "WhatsApp" / "+91…".
- Real Expert returns the existing lead for a duplicate phone or email,
  so a contact is never created twice.
- **Stages.** Real Expert has fixed stages (Lead, Showing, Offer
  Received, Under Contract, Closing, Closed Won, Closed Lost, …).
  A Whatspert stage with the same name is matched automatically, won and
  lost deals become Closed Won / Closed Lost, and other names can be
  mapped in **Advanced settings → Stage mapping**, one per line
  (`Site visit = showing`). An unmatched stage leaves the Real Expert
  stage unchanged and logs a note on the lead instead.
- Messages are logged as `sms` activities by default; this can be set
  to `note` or any activity type that exists in Real Expert.

## Real Expert → Whatspert: new leads

```
POST https://whatspertcrm.tech/api/integrations/real-expert/inbound/<integration id>
X-Webhook-Signature: <hex HMAC-SHA256 of the body, keyed with the token>

{ "event": "lead.created", "timestamp": "…",
  "data": { "lead_id": 77, "first_name": "Ravi", "last_name": "Kumar",
            "phone": "9876543210", "email": null, "source": "website", "status": "new" } }
```

This is exactly what Real Expert's webhooks send when the token is set
as the webhook Secret. Whatspert then:

1. adds the lead as a WhatsApp contact (numbers without a country code
   get +91, changeable in Advanced settings);
2. links the contact to the Real Expert lead, so it is not pushed back;
3. sends the chosen welcome template, with `{{1}}` set to the first name.

Other events are acknowledged and ignored. Leads that Whatspert itself
created in Real Expert (source "whatsapp") are not greeted again.

Other systems can call the same URL with `Authorization: Bearer <token>`
and a flat body: `{ "lead_id", "name" or "first_name"/"last_name",
"phone", "email", "template": { "name", "language", "variables": [] } }`.

Responses:

| Status | Meaning |
| --- | --- |
| 200 | `{ contact_id, conversation_id, message_sent, whatsapp_message_id }`, or `{ ignored: true }` |
| 400 | Missing or invalid phone number, or WhatsApp rejected the template (`code` says why) |
| 401 | Wrong token or signature |
| 403 | Receiving leads is switched off for this account |
| 404 | Unknown integration id |
| 429 | More than 120 requests a minute |
