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

## API contract Real Expert needs to support

These are the default paths. Each one can be changed per account under
**Advanced settings** if Real Expert's API uses different ones.

### Authentication

Every request carries the client's API key, either as
`Authorization: Bearer <key>` (default) or as `X-API-Key: <key>`.
Requests also send `Idempotency-Key: whatspert-<kind>-<id>`, so Real
Expert can safely ignore a repeated delivery.

### Test connection: `GET /api/v1/me`

Any authenticated endpoint that returns 2xx for a valid key.

### Create lead: `POST /api/v1/leads`

```json
{
  "name": "Asha Verma",
  "phone": "+919876543210",
  "email": null,
  "company": null,
  "source": "WhatsApp",
  "whatspert_contact_id": "6f1c…",
  "created_at": "2026-10-01T10:00:00Z"
}
```

The response must include the lead id, in any of these places: `id`,
`lead_id`, `data.id`, `lead.id` or `data.lead.id`. If a lead with this
phone number already exists, Real Expert should return the existing
lead instead of creating a duplicate.

### Deal / stage update: `POST /api/v1/leads/{lead_id}/stage`

```json
{
  "lead_id": "RE-1042",
  "whatspert_deal_id": "9a2e…",
  "title": "2BHK Gomti Nagar",
  "value": 4500000,
  "currency": "INR",
  "status": "open",
  "stage": { "id": "…", "name": "Site visit", "position": 2 },
  "pipeline": { "id": "…", "name": "Sales" },
  "expected_close_date": null,
  "updated_at": "2026-10-02T09:30:00Z"
}
```

`status` is `open`, `won` or `lost`. Real Expert maps the stage name onto
its own stages.

### Message log: `POST /api/v1/leads/{lead_id}/activities`

```json
{
  "lead_id": "RE-1042",
  "type": "whatsapp_message",
  "direction": "inbound",
  "sender": "customer",
  "message_type": "text",
  "text": "Is the flat still available?",
  "media_url": null,
  "template_name": null,
  "status": "delivered",
  "whatspert_message_id": "…",
  "whatsapp_message_id": "wamid.…",
  "sent_at": "2026-10-02T09:31:00Z"
}
```

`direction` is `inbound` (from the customer) or `outbound` (from an
agent, bot or broadcast).

## Real Expert → Whatspert: new leads

On the Integrations page, switch on **Real Expert leads → WhatsApp** and
pick an approved template. The page then shows a webhook URL and a token
to add in Real Expert:

```
POST https://whatspertcrm.tech/api/integrations/real-expert/inbound/<integration id>
Authorization: Bearer rex_…        (or X-Whatspert-Token: rex_…)
Content-Type: application/json

{
  "lead_id": "RE-1042",
  "name": "Asha Verma",
  "phone": "98765 43210",
  "email": "asha@example.com",
  "company": null,
  "template": { "name": "site_visit_invite", "language": "en", "variables": ["Asha"] }
}
```

- The body can also be wrapped as `{ "lead": { … } }`.
- `phone` can also be sent as `mobile` or `whatsapp`. A number without a
  country code gets the account's default code (91 unless changed).
- `template` is optional. Without it, the template chosen on the
  Integrations page is sent, with `{{1}}` filled with the lead's first
  name.
- Pass `lead_id`. With it, the contact is linked to the lead and is not
  sent back to Real Expert as a new lead.

Responses:

| Status | Meaning |
| --- | --- |
| 200 | `{ contact_id, conversation_id, message_sent, whatsapp_message_id }` |
| 400 | Missing or invalid phone number, or WhatsApp rejected the template (`code` says why) |
| 401 | Wrong or missing token |
| 403 | Receiving leads is switched off for this account |
| 404 | Unknown integration id |
| 429 | More than 120 requests a minute |
