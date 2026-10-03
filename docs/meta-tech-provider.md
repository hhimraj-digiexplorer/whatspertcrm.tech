# Becoming a Meta Tech Provider (WhatsApp)

This is the checklist for registering Digi Explorer Branding Solution as a
Meta **Tech Provider**. Once approved, clients connect their own WhatsApp
number to Whatspert CRM in one click ("Connect with Facebook" on the
WhatsApp setup page). They do not need to copy ids and tokens.

As a Tech Provider, each client pays Meta directly for WhatsApp
conversations. They add a payment method to their WhatsApp Business
Account during signup or later in WhatsApp Manager. DigiExplorer bills
clients only for the Whatspert subscription (Razorpay).

The app side is already built:

| Meta requirement | Where it is in Whatspert |
| --- | --- |
| Embedded Signup | `/whatsapp` → "Connect with Facebook" and "Use my WhatsApp Business app number" (coexistence) |
| Code exchange, webhook subscription, number registration | `POST /api/whatsapp/embedded-signup` |
| Webhook endpoint | `https://whatspertcrm.tech/api/whatsapp/webhook` |
| Send messages (`whatsapp_business_messaging`) | Inbox, broadcasts, automations, API |
| Manage templates (`whatsapp_business_management`) | Settings → Templates |
| Privacy policy | `https://whatspertcrm.tech/privacy` |
| Terms of service | `https://whatspertcrm.tech/terms` |
| Data deletion instructions | `https://whatspertcrm.tech/data-deletion` |
| Disconnect / revoke access | `/whatsapp` → Disconnect |

## 1. Before you start

- [x] Company details in `src/lib/brand.ts` (`COMPANY`) now match the GST
  certificate. Still to add: a business phone number.
- [ ] Deploy to `https://whatspertcrm.tech` so the policy pages are live.
- [ ] Use a business email on the domain (e.g. `support@whatspertcrm.tech`).
- [ ] Have a 1024 × 1024 app icon (the Whatspert logo) ready.

## 2. Business verification

In [Meta Business Suite](https://business.facebook.com) → **Settings →
Business info → Business verification**:

- [ ] Business name: **Digi Explorer Branding Solution** (trade name on the
      GST certificate; sole proprietorship of Himanshu Himraj).
- [ ] Address: **1/163, Vibhav Khand, Gomti Nagar, Lucknow, Uttar Pradesh
      226010** — the same as the GST certificate and the website footer.
- [ ] Phone: a number you can receive a call or SMS on for the check.
- [ ] Document: the **GST registration certificate (Form GST REG-06,
      GSTIN 09ALRPH8178A1ZR)**. If Meta asks for a second document, use a
      bank statement or utility bill in the business name at the same address.
- [ ] Verify the domain `whatspertcrm.tech` (**Brand safety → Domains**, DNS TXT record).

Verification usually takes 2–10 working days.

## 3. Create the Meta app

In [developers.facebook.com/apps](https://developers.facebook.com/apps):

- [ ] **Create app** → type **Business** → link it to the verified business portfolio.
- [ ] Add the **WhatsApp** product.
- [ ] Add the **Facebook Login for Business** product.
- [ ] **App settings → Basic**:
  - Display name: `Whatspert CRM`
  - App domains: `whatspertcrm.tech`
  - Contact email: `support@whatspertcrm.tech`
  - Privacy policy URL: `https://whatspertcrm.tech/privacy`
  - Terms of service URL: `https://whatspertcrm.tech/terms`
  - User data deletion: **Data deletion instructions URL** →
    `https://whatspertcrm.tech/data-deletion`
  - App icon (1024 × 1024), category **Business and pages**
- [ ] Copy the **App ID** and **App secret** into the server environment:

```
NEXT_PUBLIC_META_APP_ID=<app id>
META_APP_SECRET=<app secret>
```

## 4. Webhooks

**WhatsApp → Configuration → Webhook**:

- [ ] Callback URL: `https://whatspertcrm.tech/api/whatsapp/webhook`
- [ ] Verify token: any long random string. Set the same value on the server:

```
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<the same random string>
```

- [ ] Subscribe to these fields: `messages`, `message_template_status_update`,
      `message_template_quality_update`, `message_template_components_update`.

The app subscribes each client's WhatsApp Business Account to these
webhooks automatically when they finish Embedded Signup. Incoming
webhooks are checked against `META_APP_SECRET`.

## 5. Embedded Signup configuration

**Facebook Login for Business → Configurations → Create configuration**:

- [ ] Name: `Whatspert Embedded Signup`
- [ ] Login variation: **WhatsApp Embedded Signup**
- [ ] Access token: **System-user access token**, expiry **Never**
- [ ] Assets: **WhatsApp accounts**
- [ ] Permissions: `whatsapp_business_management`, `whatsapp_business_messaging`
- [ ] Copy the **Configuration ID**:

```
NEXT_PUBLIC_META_ES_CONFIG_ID=<configuration id>
```

**Facebook Login for Business → Settings**:

- [ ] Login with the JavaScript SDK: **On**
- [ ] Allowed domains for the JavaScript SDK: `https://whatspertcrm.tech`
- [ ] Valid OAuth redirect URIs: `https://whatspertcrm.tech/whatsapp`

Redeploy after setting the variables. The "Connect with Facebook" button
switches on once both `NEXT_PUBLIC_META_*` values are set.

## 6. Test before App Review

While the app is unpublished, only people with a role on the app can use
it. Add yourself and a teammate under **App roles**.

- [ ] Sign in to Whatspert → **WhatsApp setup** → **Connect with Facebook**,
      and finish the popup with a test business and a fresh number.
- [ ] The number shows as **Connected** with quality and messaging limit.
- [ ] Send a WhatsApp message from your phone to the number. It appears in **Inbox**.
- [ ] Reply from the Inbox (within 24 hours). It arrives on the phone.
- [ ] **Settings → Templates** → create a template → submit. Its status
      changes to Pending, then Approved, through the template webhooks.

## 7. App Review

**App Review → Permissions and features**. Request **Advanced access** for:

- [ ] `whatsapp_business_messaging`
- [ ] `whatsapp_business_management`

Meta needs a screen recording for each permission. Record in English at
1080p with no sound needed, and add captions or on-screen notes. Show the
whole flow without cuts.

**Video 1: `whatsapp_business_messaging`** (about 1 minute)

1. Open `https://whatspertcrm.tech/login` and sign in.
2. Open **Inbox**, pick a conversation (or start one from **Contacts**
   with an approved template).
3. Type a message and press Send.
4. Show the phone receiving the message in WhatsApp.

Use description (paste in the form):

> Whatspert CRM is a WhatsApp customer-support and sales inbox for small
> businesses. We use whatsapp_business_messaging to send and receive
> messages on behalf of businesses that connect their own WhatsApp
> Business Account through Embedded Signup. Agents reply to customers
> from a shared inbox, and businesses send approved template messages to
> customers who opted in.

**Video 2: `whatsapp_business_management`** (about 1–2 minutes)

1. Sign in and open **Settings → Templates**.
2. Click **New template**, fill in name, category, language and body,
   and submit it.
3. Show the template in the list with status **Pending**.
4. Optionally, show the same template in WhatsApp Manager.

Use description:

> We use whatsapp_business_management to let businesses create, submit
> and track their WhatsApp message templates, read their phone number
> details and quality rating, and subscribe their WhatsApp Business
> Account to our webhooks after they connect it through Embedded Signup.

Also complete the **Data handling** questions (data processors: Supabase,
hosting provider, Razorpay; no data sold; deletion via the data deletion
page) and **Access verification** if the dashboard asks for it.

Review usually takes 3–7 working days. If it is rejected, the reviewer's
note says which step they could not see; re-record that step.

## 8. Go live

- [ ] Switch the app to **Live** mode (top bar of the App Dashboard).
- [ ] In **WhatsApp → Partner solutions / Tech Provider onboarding**,
      complete any remaining steps Meta shows.
- [ ] Onboard the first client with "Connect with Facebook" and check
      that messages arrive.

Meta limits how many new client businesses an app can onboard per week
until the business and access verification are complete. The current
limit is shown in the App Dashboard.

## Environment variables

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_META_APP_ID` | App settings → Basic → App ID |
| `META_APP_SECRET` | App settings → Basic → App secret |
| `NEXT_PUBLIC_META_ES_CONFIG_ID` | Facebook Login for Business → Configurations |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | A random string you choose; same value in WhatsApp → Configuration |
