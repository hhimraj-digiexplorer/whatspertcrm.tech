#!/usr/bin/env bash
# ============================================================
# Whatspert CRM — one-command install on a fresh Ubuntu VPS
# (Hostinger KVM or any Ubuntu 22.04 / 24.04 server).
#
# Installs and wires together:
#   - Docker
#   - Supabase, self-hosted (database, login, realtime, storage)
#   - all Whatspert database migrations
#   - the Whatspert app (Docker), private on 127.0.0.1:3000
#   - Caddy with automatic HTTPS for <domain> and api.<domain>
#   - cron jobs (automations, flows, Real Expert sync) and a daily backup
#
# Run as root:
#   curl -fsSL https://raw.githubusercontent.com/hhimraj-digiexplorer/whatspertcrm.tech/claude/nice-gates-gno3ea/deploy/vps/install.sh | bash
#
# Safe to run again: it keeps existing secrets and data, pulls the
# latest code, rebuilds, and applies new migrations. That is also how
# you update (or run `whatspert-update`).
#
# Answers are stored in /opt/whatspert/config.env (root-only). Edit it
# and re-run to change Meta / Razorpay / partner settings later.
# ============================================================
set -euo pipefail

REPO_URL="${WHATSPERT_REPO:-https://github.com/hhimraj-digiexplorer/whatspertcrm.tech.git}"
REPO_BRANCH="${WHATSPERT_BRANCH:-claude/nice-gates-gno3ea}"
BASE=/opt/whatspert
APP_DIR="$BASE/app"
SB_DIR="$BASE/supabase"
CONFIG="$BASE/config.env"
LOG="$BASE/install.log"

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (sudo -i first)."
command -v apt-get >/dev/null || die "This installer supports Ubuntu/Debian only."
mkdir -p "$BASE" && chmod 700 "$BASE"
exec > >(tee -a "$LOG") 2>&1

# ------------------------------------------------------------
# Answers (asked once, kept in config.env)
# ------------------------------------------------------------
touch "$CONFIG" && chmod 600 "$CONFIG"
# shellcheck disable=SC1090
. "$CONFIG"

ask() { # ask VAR "Question" "default" [secret]
  local var=$1 q=$2 def=${3:-} secret=${4:-} val
  # Already answered (even if left blank) — keep it; edit config.env to change.
  if [ -n "${!var+x}" ]; then return; fi
  if [ -n "$secret" ]; then
    read -r -s -p "$q${def:+ [$def]}: " val </dev/tty; echo
  else
    read -r -p "$q${def:+ [$def]}: " val </dev/tty
  fi
  val="${val:-$def}"
  printf -v "$var" '%s' "$val"
  printf '%s=%q\n' "$var" "$val" >>"$CONFIG"
}
keep() { # keep VAR value — store a generated value once
  local var=$1 val=$2
  if [ -z "${!var:-}" ]; then
    printf -v "$var" '%s' "$val"
    printf '%s=%q\n' "$var" "$val" >>"$CONFIG"
  fi
}

say "A few questions (press Enter to accept [defaults]; leave optional ones blank and fill them in later)"
ask DOMAIN            "Your domain" "whatspertcrm.tech"
ask ADMIN_EMAIL       "Your email (super-admin login, and HTTPS certificate notices)"
echo "Email sending for sign-up / password-reset mails (Hostinger mailbox, e.g. support@$DOMAIN)."
ask SMTP_HOST         "SMTP host" "smtp.hostinger.com"
ask SMTP_PORT         "SMTP port" "465"
ask SMTP_USER         "SMTP username (full mailbox address)" "support@$DOMAIN"
ask SMTP_PASS         "SMTP password (mailbox password; blank = skip email confirmation)" "" secret
ask META_APP_ID       "Meta App ID (optional now)" "1724019862034618"
ask META_APP_SECRET   "Meta App Secret (optional now — paste the NEW one after Reset)" "" secret
ask META_ES_CONFIG_ID "Meta Embedded Signup configuration ID (optional now)" ""
ask RAZORPAY_KEY_ID   "Razorpay Key ID (optional now)" ""
ask RAZORPAY_KEY_SECRET "Razorpay Key Secret (optional now)" "" secret
ask RAZORPAY_WEBHOOK_SECRET "Razorpay webhook secret (optional now)" "" secret
ask REAL_EXPERT_PARTNER_SECRET "Real Expert partner secret (optional now)" "" secret
ask PARTNER_FRAME_ANCESTORS "Real Expert address allowed to embed Whatspert" "https://crm.digiexplorer.in"

API_DOMAIN="api.$DOMAIN"
keep ENCRYPTION_KEY "$(openssl rand -hex 32)"
keep CRON_SECRET "$(openssl rand -hex 24)"
keep WEBHOOK_VERIFY_TOKEN "$(openssl rand -hex 24)"

# ------------------------------------------------------------
# System: packages, swap, firewall, Docker, Caddy
# ------------------------------------------------------------
say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl ufw gnupg debian-keyring debian-archive-keyring apt-transport-https cron >/dev/null

# Supabase + a Next.js build need ~4 GB; add swap on small plans.
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 7800 ] && ! swapon --show | grep -q /swapfile; then
  say "Adding 4 GB swap (server has ${mem_mb} MB RAM)"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null

if ! command -v caddy >/dev/null; then
  say "Installing Caddy (HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

say "Firewall: allowing SSH, HTTP, HTTPS only"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# ------------------------------------------------------------
# DNS check (warn only — HTTPS certificates need it)
# ------------------------------------------------------------
server_ip=$(curl -fsS4 https://api.ipify.org || true)
for host in "$DOMAIN" "www.$DOMAIN" "$API_DOMAIN"; do
  resolved=$(getent ahostsv4 "$host" | awk 'NR==1{print $1}')
  if [ -z "$resolved" ] || [ "$resolved" != "$server_ip" ]; then
    warn "DNS: $host -> ${resolved:-nothing}, but this server is $server_ip. Add an A record '$host -> $server_ip' in Hostinger DNS. HTTPS for it starts working a few minutes after DNS is right."
  fi
done

# ------------------------------------------------------------
# Supabase (self-hosted)
# ------------------------------------------------------------
if [ ! -f "$SB_DIR/docker-compose.yml" ]; then
  say "Downloading Supabase (self-hosted)"
  rm -rf "$BASE/supabase-src"
  git clone --depth 1 --filter=blob:none --sparse https://github.com/supabase/supabase "$BASE/supabase-src" >/dev/null
  git -C "$BASE/supabase-src" sparse-checkout set docker >/dev/null
  mkdir -p "$SB_DIR"
  cp -a "$BASE/supabase-src/docker/." "$SB_DIR/"
  git -C "$BASE/supabase-src" rev-parse HEAD >"$SB_DIR/SUPABASE_COMMIT"
  rm -rf "$BASE/supabase-src"
fi

cd "$SB_DIR"
if [ ! -f .env ]; then
  say "Generating Supabase secrets"
  cp .env.example .env
  sh utils/generate-keys.sh --update-env >/dev/null
  if [ -f utils/add-new-auth-keys.sh ]; then sh utils/add-new-auth-keys.sh --update-env >/dev/null || warn "Optional new-style Supabase keys were not generated (not needed by Whatspert)."; fi
fi

setenv() { # setenv KEY VALUE (in Supabase .env)
  local k=$1 v=$2
  if grep -q "^$k=" .env; then
    python3 - "$k" "$v" <<'PY'
import sys, re
k, v = sys.argv[1], sys.argv[2]
v = v.replace('$', '$$')  # Compose would read "$x" as a variable
p = '.env'
s = open(p).read()
s = re.sub(rf'^{re.escape(k)}=.*$', lambda m: f'{k}={v}', s, flags=re.M)
open(p, 'w').write(s)
PY
  else
    echo "$k=$v" >>.env
  fi
}
getenv() { grep -m1 "^$1=" .env | cut -d= -f2-; }

# The Auth URL format changed upstream; follow whichever this copy uses.
if grep -q '^API_EXTERNAL_URL=.*/auth/v1' .env.example; then auth_url="https://$API_DOMAIN/auth/v1"; else auth_url="https://$API_DOMAIN"; fi
setenv SUPABASE_PUBLIC_URL "https://$API_DOMAIN"
setenv API_EXTERNAL_URL "$auth_url"
setenv SITE_URL "https://$DOMAIN"
setenv ADDITIONAL_REDIRECT_URLS "https://$DOMAIN/**,https://www.$DOMAIN/**"
setenv POOLER_TENANT_ID "whatspert"
setenv ENABLE_PHONE_SIGNUP "false"
setenv SMTP_ADMIN_EMAIL "$SMTP_USER"
setenv SMTP_SENDER_NAME "Whatspert CRM"
if [ -n "$SMTP_PASS" ]; then
  setenv SMTP_HOST "$SMTP_HOST"; setenv SMTP_PORT "$SMTP_PORT"
  setenv SMTP_USER "$SMTP_USER"; setenv SMTP_PASS "$SMTP_PASS"
  setenv ENABLE_EMAIL_AUTOCONFIRM "false"
else
  warn "No SMTP password: new sign-ups are confirmed automatically (no confirmation email). Add it later in $CONFIG and re-run."
  setenv ENABLE_EMAIL_AUTOCONFIRM "true"
fi

# Keep every Supabase port private (Docker-published ports bypass ufw);
# Caddy is the only way in.
sed -i -E 's#^(\s+- "?)(\$\{.*\}:[0-9]+(/tcp)?"?)\s*$#\1127.0.0.1:\2#' docker-compose.yml

say "Starting Supabase (first start downloads ~2 GB, takes a few minutes)"
docker compose pull -q
docker compose up -d

wait_healthy() {
  local name=$1 status
  for _ in $(seq 1 120); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo missing)
    [ "$status" = "healthy" ] && return 0
    sleep 5
  done
  die "$name did not become healthy. See: docker logs $name"
}
for c in supabase-db supabase-auth supabase-rest supabase-storage; do wait_healthy "$c"; done

ANON_KEY=$(getenv ANON_KEY)
SERVICE_ROLE_KEY=$(getenv SERVICE_ROLE_KEY)
DASHBOARD_USERNAME=$(getenv DASHBOARD_USERNAME)
DASHBOARD_PASSWORD=$(getenv DASHBOARD_PASSWORD)

# ------------------------------------------------------------
# Whatspert code
# ------------------------------------------------------------
say "Getting Whatspert ($REPO_BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$REPO_BRANCH"
  git -C "$APP_DIR" checkout -q -B "$REPO_BRANCH" "origin/$REPO_BRANCH"
else
  git clone -q --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi

# ------------------------------------------------------------
# Database migrations (each applied once, in order)
# ------------------------------------------------------------
say "Applying database migrations"
PGPASS=$(getenv POSTGRES_PASSWORD)
psql_as() { docker exec -i -e PGPASSWORD="$PGPASS" supabase-db psql -h localhost -v ON_ERROR_STOP=1 -q -U "$1" -d postgres; }
echo "SET client_min_messages = warning; CREATE TABLE IF NOT EXISTS public.whatspert_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON public.whatspert_migrations FROM anon, authenticated;" | psql_as postgres
applied=$(docker exec -e PGPASSWORD="$PGPASS" supabase-db psql -h localhost -At -U postgres -d postgres -c "SELECT name FROM public.whatspert_migrations")
for f in "$APP_DIR"/supabase/migrations/*.sql; do
  name=$(basename "$f")
  grep -qx "$name" <<<"$applied" && continue
  echo "   $name"
  if ! psql_as postgres <"$f" 2>"$BASE/migration-error.log"; then
    # A few statements (e.g. triggers on auth.users) may need the
    # platform owner on self-hosted images.
    warn "$name needed elevated rights; retrying as supabase_admin"
    psql_as supabase_admin <"$f" || die "Migration $name failed. Details: $BASE/migration-error.log"
  fi
  echo "INSERT INTO public.whatspert_migrations(name) VALUES ('$name')" | psql_as postgres
done
# New tables must be visible to the API straight away.
echo "NOTIFY pgrst, 'reload schema'" | psql_as postgres

# ------------------------------------------------------------
# App configuration and build
# ------------------------------------------------------------
say "Writing app settings"
umask 077
cat >"$APP_DIR/.env.local" <<EOF
# Generated by deploy/vps/install.sh — edit $CONFIG and re-run instead.
NEXT_PUBLIC_SUPABASE_URL=https://$API_DOMAIN
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL=https://$DOMAIN
NEXT_PUBLIC_APP_LOCALE=en
ENCRYPTION_KEY=$ENCRYPTION_KEY
SUPER_ADMIN_EMAILS=$ADMIN_EMAIL
AUTOMATION_CRON_SECRET=$CRON_SECRET
NEXT_PUBLIC_META_APP_ID=$META_APP_ID
META_APP_ID=$META_APP_ID
META_APP_SECRET=$META_APP_SECRET
NEXT_PUBLIC_META_ES_CONFIG_ID=$META_ES_CONFIG_ID
WHATSAPP_WEBHOOK_VERIFY_TOKEN=$WEBHOOK_VERIFY_TOKEN
RAZORPAY_KEY_ID=$RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET=$RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET=$RAZORPAY_WEBHOOK_SECRET
REAL_EXPERT_PARTNER_SECRET=$REAL_EXPERT_PARTNER_SECRET
PARTNER_FRAME_ANCESTORS=$PARTNER_FRAME_ANCESTORS
HOST_IP=127.0.0.1
HOST_PORT=3000
EOF
umask 022

say "Building and starting Whatspert (5–10 minutes the first time)"
cd "$APP_DIR"
docker compose --env-file .env.local up -d --build
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null http://127.0.0.1:3000/ && break
  sleep 5
done
curl -fsS -o /dev/null http://127.0.0.1:3000/ || die "Whatspert did not start. See: cd $APP_DIR && docker compose logs app"

# ------------------------------------------------------------
# HTTPS (Caddy)
# ------------------------------------------------------------
say "Configuring HTTPS"
cat >/etc/caddy/Caddyfile <<EOF
{
	email $ADMIN_EMAIL
}

$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}

www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}

# Supabase API + dashboard (dashboard asks for its own username/password)
$API_DOMAIN {
	reverse_proxy 127.0.0.1:8000
}
EOF
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# ------------------------------------------------------------
# Scheduled jobs and backups
# ------------------------------------------------------------
say "Scheduling jobs and daily backups"
mkdir -p "$BASE/backups"
cat >/etc/cron.d/whatspert <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
* * * * * root curl -fsS -m 50 -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/automations/cron >/dev/null 2>&1
* * * * * root curl -fsS -m 50 -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/flows/cron >/dev/null 2>&1
*/5 * * * * root curl -fsS -m 120 -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/integrations/cron >/dev/null 2>&1
30 2 * * * root docker exec -e PGPASSWORD=$PGPASS supabase-db pg_dump -h localhost -U postgres -d postgres -Fc > $BASE/backups/whatspert-\$(date +\%F).dump && find $BASE/backups -name '*.dump' -mtime +14 -delete
EOF
# Holds the cron and database secrets: root only.
chmod 600 /etc/cron.d/whatspert

cat >/usr/local/bin/whatspert-update <<EOF
#!/usr/bin/env bash
# Pull the latest Whatspert, apply new migrations, rebuild.
curl -fsSL https://raw.githubusercontent.com/hhimraj-digiexplorer/whatspertcrm.tech/$REPO_BRANCH/deploy/vps/install.sh | bash
EOF
chmod 755 /usr/local/bin/whatspert-update

# ------------------------------------------------------------
# Summary (secrets saved root-only in $BASE/CREDENTIALS.txt)
# ------------------------------------------------------------
cat >"$BASE/CREDENTIALS.txt" <<EOF
Whatspert CRM            https://$DOMAIN
Super-admin email        $ADMIN_EMAIL   (sign up with this email, then open /admin)

Supabase dashboard       https://$API_DOMAIN
  username               $DASHBOARD_USERNAME
  password               $DASHBOARD_PASSWORD

Meta (WhatsApp → Configuration → Webhook)
  Callback URL           https://$DOMAIN/api/whatsapp/webhook
  Verify token           $WEBHOOK_VERIFY_TOKEN

Razorpay webhook URL     https://$DOMAIN/api/billing/webhook
Backups                  $BASE/backups (daily 02:30, 14 days)
Update later             whatspert-update
EOF
chmod 600 "$BASE/CREDENTIALS.txt"

say "Done!"
cat "$BASE/CREDENTIALS.txt"
echo
echo "These details are saved in $BASE/CREDENTIALS.txt (root only)."
[ -z "$META_APP_SECRET" ] && warn "Meta App Secret not set yet — add it to $CONFIG and run whatspert-update."
[ -z "$META_ES_CONFIG_ID" ] && warn "Meta Embedded Signup config ID not set yet — 'Connect with Facebook' stays off until you add it and run whatspert-update."
exit 0
