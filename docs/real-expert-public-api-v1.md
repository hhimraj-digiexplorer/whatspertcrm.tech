# Real Expert CRM — Public API v1

The contract an external system integrates against. Built to the Whatspert specification, but
nothing in it is Whatspert-specific — the same four endpoints serve any WhatsApp tool, dialler or
portal a client wants to connect.

Base URL: `https://crm.digiexplorer.in/api/v1`

---

## Getting a key

In the CRM: **Integrations → API access → Create key.**

The key is shown **once**. Only a hash is stored, so a leaked database backup cannot be turned
back into access to a client's leads — and neither can we recover it for you. Lose it, revoke it
and make another.

A key belongs to exactly one workspace. Every request is scoped to that workspace, so a key can
never read or write another client's leads. There is no account-wide key.

Revoking is immediate and does not delete the record, so what the key did stays attributable.

## Authentication

Either header works:

```
Authorization: Bearer rex_live_xxxxxxxx…
X-API-Key: rex_live_xxxxxxxx…
```

An unknown key and a revoked key both return `401` with the same message. Which it is would only
be useful to somebody probing for valid keys.

## Idempotency

Send `Idempotency-Key: <your-id>` on any POST. A repeat of the same key on the same endpoint
returns the **first** response without acting again, for 48 hours — comfortably past a retry
schedule of 1, 5, 15, 60 and 180 minutes.

Leads are also deduplicated on the phone number independently of this, so even an un-keyed retry
cannot create a second lead for the same person.

---

## `GET /v1/me`

Connection test. Returns the workspace the key belongs to, which makes a key pasted into the wrong
client's integration immediately obvious.

```json
{ "ok": true, "workspace": { "id": "…", "name": "GSR Developers" }, "api_version": "v1" }
```

## `POST /v1/leads`

Creates a lead, or returns the existing one for that phone number.

```json
{
  "name": "Asha Verma",
  "phone": "+919876543210",
  "email": null,
  "source": "WhatsApp",
  "whatspert_contact_id": "6f1c…",
  "created_at": "2026-10-01T10:00:00Z"
}
```

At least one of `phone` or `email` is required. A number without a country code is treated as
Indian.

**201** when created, **200** when it already existed:

```json
{ "id": "…", "lead_id": "…", "status": "created", "duplicate": false }
```

`source` is stored as the lead's origin. A lead marked as coming from your system is **never**
pushed back out to you — that is what stops a loop.

## `POST /v1/leads/{lead_id}/stage`

`{lead_id}` may be our uuid, the external id you sent, or the lead's phone number.

```json
{
  "title": "2BHK Gomti Nagar",
  "value": 4500000,
  "currency": "INR",
  "status": "open",
  "stage": { "name": "Site visit" },
  "pipeline": { "name": "Sales" }
}
```

The stage **name** is matched case-insensitively against the workspace's own stages.

- **It matches** → the lead moves, and a stage-change appears on its timeline.
- **It does not match** → the stage is left alone. The title, value and status are still recorded
  as a note. We will not guess: marching somebody's lead through their pipeline on a word that
  happened to be close is worse than doing nothing.

```json
{ "ok": true, "lead_id": "…", "stage_matched": "Site Visit", "stage_applied": true, "stage_moved": true }
```

`stage_applied` means *the lead is in the stage you asked for* — true even if it was already
there. `stage_moved` says whether we actually had to move it.

## `POST /v1/leads/{lead_id}/activities`

One row per message. Appears on the lead's timeline beside the calls, so a salesperson sees the
whole conversation without leaving the CRM.

```json
{
  "type": "whatsapp_message",
  "direction": "inbound",
  "sender": "customer",
  "message_type": "text",
  "text": "Is the flat still available?",
  "media_url": null,
  "template_name": null,
  "status": "delivered",
  "whatsapp_message_id": "wamid.…",
  "sent_at": "2026-10-02T09:31:00Z"
}
```

An `inbound` message also counts as activity on the lead, which keeps it out of the stale list.

---

## Real Expert → your system: new leads

**Integrations → API access → Send new leads to.** Give a URL and a bearer token, then **Send a
test** before going live.

Every lead created from any source — Meta, Google, website, portals, manual entry — is POSTed:

```
POST <your url>
Authorization: Bearer <your token>
Content-Type: application/json

{
  "lead_id": "…",
  "name": "Asha Verma",
  "phone": "+919876543210",
  "email": null,
  "company": null,
  "source": "META",
  "project": "GSR Heights",
  "city": "Lucknow",
  "created_at": "2026-10-02T09:30:00Z"
}
```

**Leads your system created are not sent back.** That is the loop guard, and it is why
`source` on the way in matters.

Delivery is queued, never blocking the enquiry being saved. A 5xx or a timeout is retried; a 4xx
is not, because the request itself is what is wrong. The last status and error are shown on the
Integrations screen so a broken endpoint is visible rather than silent.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | Invalid body — the message says what is wrong |
| 401 | Missing, unknown or revoked key |
| 402 | The workspace is on a plan whose lead limit is reached |
| 404 | No such lead **in this workspace** |
| 409 | Conflicts with something that already exists |
| 503 | Temporary — safe to retry |
