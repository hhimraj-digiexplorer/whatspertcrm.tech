# Deploy Whatspert CRM on a Hostinger VPS

Everything runs on your own VPS — no paid Supabase plan:

- **Supabase, self-hosted** (database, login, live inbox, file storage)
- **Whatspert** (the app)
- **Caddy** for free automatic HTTPS
- scheduled jobs and a **daily database backup**

One command installs all of it.

## What you need

- A Hostinger **VPS** (KVM 2 or bigger recommended: 2 vCPU / 8 GB RAM;
  KVM 1 works, the installer adds swap) running **Ubuntu 24.04**.
- The domain `whatspertcrm.tech`.
- A mailbox for sending sign-up / password-reset emails, e.g.
  `support@whatspertcrm.tech` (Hostinger Email) and its password.

## 1. Point the domain at the VPS

hPanel → **Domains** → whatspertcrm.tech → **DNS / Nameservers** → DNS
records. Add (or edit) three **A** records, all pointing to your VPS IP
(hPanel → VPS → Overview shows it):

| Type | Name | Points to |
|---|---|---|
| A | `@` | your VPS IP |
| A | `www` | your VPS IP |
| A | `api` | your VPS IP |

Delete any other A/AAAA records for `@`, `www` or `api` (for example a
Hostinger "parked" page). DNS usually updates within minutes.

## 2. Open the VPS terminal

hPanel → **VPS** → **Browser terminal** (or `ssh root@<VPS IP>`).
If the VPS is new and not on Ubuntu 24.04: VPS → **OS & Panel** →
Operating system → **Ubuntu 24.04** (this wipes the VPS — only on an
empty server).

## 3. Run the installer

Paste this and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/hhimraj-digiexplorer/whatspertcrm.tech/claude/nice-gates-gno3ea/deploy/vps/install.sh | bash
```

It asks a few questions. Only the first five matter now; press Enter to
skip the Meta / Razorpay / partner ones and add them later:

| Question | Answer |
|---|---|
| Your domain | Enter (`whatspertcrm.tech`) |
| Your email | your email — this becomes the super-admin |
| SMTP host / port | Enter (`smtp.hostinger.com`, `465`) |
| SMTP username | the mailbox, e.g. `support@whatspertcrm.tech` |
| SMTP password | that mailbox's password (typing is hidden) |

Then wait 15–25 minutes. At the end it prints your links, the Supabase
dashboard login and the Meta webhook details. They are also saved in
`/opt/whatspert/CREDENTIALS.txt` (`cat /opt/whatspert/CREDENTIALS.txt`).

## 4. First login

1. Open `https://whatspertcrm.tech/signup` and sign up with the email you
   gave as "Your email". Confirm it from the email you receive.
2. Open `https://whatspertcrm.tech/admin` — the platform admin.

## 5. Add Meta, Razorpay and Real Expert settings later

```bash
nano /opt/whatspert/config.env     # fill in META_APP_SECRET=..., META_ES_CONFIG_ID=..., etc.
whatspert-update                   # applies them (rebuilds the app)
```

Keys you can fill in: `META_APP_ID`, `META_APP_SECRET`, `META_ES_CONFIG_ID`,
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
`REAL_EXPERT_PARTNER_SECRET`, `PARTNER_FRAME_ANCESTORS`, `SMTP_PASS`.

## Updating

```bash
whatspert-update
```

Pulls the latest Whatspert, applies new database migrations and
rebuilds. Your data, secrets and settings are kept.

## Useful commands

| What | Command |
|---|---|
| App logs | `cd /opt/whatspert/app && docker compose logs -f app` |
| Supabase status | `cd /opt/whatspert/supabase && docker compose ps` |
| Restart the app | `cd /opt/whatspert/app && docker compose restart` |
| Backups | `ls /opt/whatspert/backups` (daily, kept 14 days) |
| Installer log | `less /opt/whatspert/install.log` |

Database dashboard: `https://api.whatspertcrm.tech` (login in
`CREDENTIALS.txt`).

## Security notes

- Only ports 22, 80 and 443 are open. Supabase and the app listen on
  127.0.0.1 and are reached through Caddy over HTTPS.
- `/opt/whatspert` (secrets, config, backups) is readable by root only.
- Copy `/opt/whatspert/backups` off the server from time to time
  (Hostinger VPS snapshots also work).
