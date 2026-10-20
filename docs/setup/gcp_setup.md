---
type: setup_guide
title: Google Cloud setup for Doer
related_feature: daily-task-planner
created: 2026-10-20
updated: 2026-10-21
---

# Google Cloud Setup for Doer

Doer runs locally (ADR 0001), but Google OAuth client credentials and Calendar API access live in a Google Cloud project, so this step is required even with no hosting. Budget about 30 minutes. No billing account is needed: the Calendar API has a free quota and project creation does not require billing.

Verified against the console as of 2026-10-20. The OAuth consent screen was renamed and reorganized into **Google Auth Platform** (sections: Branding, Audience, Data Access, Clients), so older guides that describe a single "OAuth consent screen" wizard are out of date.

## 0. Decide the audience model first

This is the one decision that determines everything else, and the wrong choice forces you to re-consent every week.

| Model | Verification | Refresh token lifetime | Who can sign in |
|---|---|---|---|
| **Internal** (project inside a Google Workspace organization) | Not required | Normal (no 7-day expiry) | Only members of that Workspace org |
| **External + Testing** | Not required | **Expires 7 days after consent** | Up to 100 listed test users |
| **External + In production**, unverified | Not required, but users see an "unverified app" warning | Normal | Capped at 100 users total |
| **External + In production**, verified | Required (weeks, needs privacy policy and often a demo video) | Normal | Unlimited |

**Do not stay in Testing.** With an External user type and a Testing publishing status, Google expires refresh tokens 7 days after consent, and the next refresh returns `invalid_grant`. For an app whose entire premise is daily use, that means reconnecting every week.

Pick one:

- **If `theagentic.ai` is a Google Workspace domain and you are happy for Doer to read that account's calendar**, use **Internal**. No verification, no warning screen, no 7-day expiry, no user cap. This is the cleanest path. The GCP project must be created inside that organization.
- **Otherwise** (for example, you want Doer on your personal Gmail calendar), use **External** and immediately **publish to production** while leaving it unverified. You will click through a "Google hasn't verified this app" warning once, at first consent. Refresh tokens then behave normally.

One permanent caveat on the External path: the 100-user cap attaches to the project and cannot be reset by creating a new OAuth client or a new project deployment. The only exit is verification. At one user this is irrelevant, but it is worth knowing before the project becomes load-bearing.

## 1. Create the project

Project IDs are globally unique, 6 to 30 characters, lowercase letters, digits, and hyphens.

```bash
PROJECT_ID="doer-app-$(date +%Y%m%d)"

# External path:
gcloud projects create "$PROJECT_ID" --name="Doer"

# Internal path: create it inside the organization instead.
gcloud organizations list                       # note the ORGANIZATION_ID
gcloud projects create "$PROJECT_ID" --name="Doer" --organization=ORGANIZATION_ID

gcloud config set project "$PROJECT_ID"
gcloud config list
```

If you are on the Internal path, first switch the active gcloud account to the Workspace identity:

```bash
gcloud auth login aman@theagentic.ai
```

Note that your gcloud is currently authenticated as `amansharma2910@gmail.com` with the active project set to `moku-editz-prod`. Confirm the project actually switched before continuing, since an accidental change to an unrelated production project is the main hazard in this section.

## 2. Enable the Calendar API

```bash
gcloud services enable calendar-json.googleapis.com
gcloud services list --enabled | grep calendar
```

## 3. Configure Google Auth Platform

There is no supported `gcloud` command for configuring the consent screen or for creating a general-purpose web application OAuth client. The `gcloud alpha iap oauth-clients` commands are Identity-Aware Proxy specific and do not apply here. Steps 3 to 5 are console work.

Go to **console.cloud.google.com** → **APIs & Services** → **Google Auth Platform**. Confirm the project selector shows your new project.

**Branding**
- App name: `Doer`
- User support email: your address
- Developer contact email: your address
- **Do not upload a logo.** A custom logo triggers brand verification, which is the one thing that turns a 30-minute setup into a multi-week review. Leave it blank.

**Audience**
- Choose **Internal** or **External** per section 0.
- If External, click **Publish app** to move the publishing status from Testing to In production. Confirm the status reads "In production" before continuing. Leaving it on Testing is the 7-day refresh token trap.
- If you stay on Testing deliberately for a short experiment, add your own Google account under Test users, and know that every authorization dies after 7 days.

## 4. Data Access (scopes)

Under **Data Access** → **Add or remove scopes**, add the identity scopes:

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

Then add exactly one calendar scope:

- `https://www.googleapis.com/auth/calendar.freebusy`

This is the scope Doer uses (ADR 0001, amended 2026-10-21). It returns availability intervals only through `freebusy.query`, so event titles and descriptions never reach the server at all, rather than being received and discarded. Do not add `calendar.readonly`: it grants read access to full event content that Doer has no use for, and it is definitely a sensitive scope.

The console marks sensitive scopes with an indicator in this list. Check the indicator next to `calendar.freebusy` when you add it, since that determines whether the unverified-app warning applies on the External path.

## 5. Create the OAuth client

**Clients** → **Create client**.

- Application type: **Web application**
- Name: `Doer local`
- Authorized JavaScript origins: `http://localhost:5173` (the Vite dev server)
- Authorized redirect URIs: `http://localhost:8787/auth/google/callback`

Redirect URIs must match byte for byte, including scheme, port, and trailing slash. `http://localhost:8787/auth/google/callback` and `http://127.0.0.1:8787/auth/google/callback` are different URIs; register both if you intend to use either. Plain `http` is permitted for localhost only.

Download the JSON or copy the client ID and client secret.

## 6. Wire the credentials into the project

Create `.env` in the repository root. Confirm `.env` is in `.gitignore` before writing anything into it: it will hold the Fernet key that protects stored refresh tokens and your Anthropic API key.

```bash
grep -q '^\.env$' .gitignore && echo ".env is ignored" || echo "WARNING: add .env to .gitignore first"
```

```env
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8787/auth/google/callback
GOOGLE_SCOPES=openid email profile https://www.googleapis.com/auth/calendar.freebusy

ANTHROPIC_API_KEY=sk-ant-...
FERNET_KEY=...
DATABASE_URL=postgresql+asyncpg://doer:doer@localhost:5432/doer
```

Generate the Fernet key once and keep it stable. Rotating it makes every stored refresh token undecryptable, which forces a reconnect:

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

## 7. Verify

With the API running, open the sign-in route and complete consent. Then confirm three things:

1. The token response contains a `refresh_token`, not only an `access_token`.
2. The stored token row decrypts and a Calendar call succeeds.
3. Signing in a second time still works without re-consent.

If the refresh token is missing, see gotcha 2 below.

## 8. Gotchas, in the order they usually bite

1. **Testing mode kills refresh tokens after 7 days.** Covered in section 0. The symptom is `invalid_grant` on refresh, roughly a week after things started working, which is exactly long enough to have forgotten this document.

2. **A refresh token is issued only on the first consent.** The authorization URL must carry `access_type=offline`. If you have already consented once and need a fresh refresh token (for example after changing scopes), you must also send `prompt=consent`, or revoke the app at myaccount.google.com/permissions and consent again. Without this, the second authorization silently returns no refresh token and everything works until the first access token expires an hour later.

3. **Changing scopes invalidates existing grants.** If you switch between `calendar.freebusy` and `calendar.readonly`, existing users must re-consent. Decide the scope before you accumulate real token rows.

4. **The 100-user cap is permanent on the project.** New OAuth clients and new deployments do not reset it. Verification is the only exit.

5. **A logo triggers brand verification.** Leave Branding's logo field empty until you actually want to be verified.

6. **`Error 400: redirect_uri_mismatch`.** The most common first failure, and it
   means Google compared what Doer sent against the list on the OAuth client and
   found no exact match. Confirm what Doer is actually sending before changing
   anything in the console:

   ```bash
   curl -s -o /dev/null -w "%{redirect_url}\n" http://localhost:8787/auth/google/login
   ```

   The `redirect_uri` parameter in that URL is the string to register, character
   for character, under **Clients → your client → Authorized redirect URIs**.
   Matching is exact: `localhost` is not `127.0.0.1`, `http` is not `https`, the
   port matters, and a trailing slash counts. Changes take a minute or two to
   propagate, so a retry immediately after saving can still fail.

7. **Publishing status and scope changes can take a few minutes to propagate.** If a change does not seem to apply, wait before debugging code.

8. **`freebusy.query` has no sync token.** It is a point-in-time query over a time range, not an incremental feed. This is intentional: Doer queries the current logical day's window on demand at day open and on explicit refresh. If you find yourself reaching for `events.list` to get incremental sync, re-read ADR 0001 first, because that would mean requesting a scope that grants full event content for a feature that only needs availability.

## 9. What changes when Doer is deployed (v2)

- Add the production redirect URI to the same OAuth client, or create a second client for the deployed environment.
- Move `.env` values into a secret manager. The Fernet key in particular must survive deploys, or every stored refresh token becomes unreadable.
- If the user count ever needs to exceed 100 on the External path, start verification early: it needs a published privacy policy, a verified domain, and usually a demo video, and it takes weeks.

## Sources

- [Get started with the Google Auth Platform](https://support.google.com/cloud/answer/15544987)
- [Unverified apps](https://support.google.com/cloud/answer/7454865)
- [When is verification not needed](https://support.google.com/cloud/answer/13464323)
- [Choose Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Freebusy: query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies)
