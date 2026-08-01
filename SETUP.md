# Setup checklist

Everything **you** need to do. Ordered by when it blocks work.

Legend: 🔴 blocks local dev · 🟡 blocks login · 🟢 blocks deploy only

---

## ✅ Done already

Node 26, Neon Postgres, Google OAuth, the schema migration, and the import of
all 315 trades are complete. Sign-in works. What remains is only §4 (deploy) and
optionally §5 (US dividends).

<details>
<summary>Original setup steps, for reference</summary>

## 0. Node 20+ (done — running v26.5.0)

Current local Node is **v16.14.2**. TanStack Start (Vite 6/7) needs **Node 20.19+**; Node 22 LTS recommended.

```bash
# via nvm (recommended — lets you switch per project)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22 && nvm use 22 && nvm alias default 22

# or via Homebrew
brew install node@22 && brew link --overwrite --force node@22
```

Verify: `node -v` → `v22.x`, `npm -v` → `10.x`+

**Nothing else on this list blocks me from starting.** The CSV parsers and P&L engine are pure TypeScript with unit tests — I build and verify those against your real 315 trades with no database and no auth. Do the rest whenever.

---

## 1. 🟡 Neon Postgres

1. Sign up at **https://neon.tech** (free tier, GitHub/Google login)
2. **Create project** → name `pnltracker`, region **AWS ap-northeast-1 (Tokyo)** (lowest latency from Japan)
3. Copy the **pooled** connection string from the dashboard — it looks like:
   ```
   postgresql://USER:PASS@ep-xxx-pooler.ap-northeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   ⚠️ Use the **`-pooler`** host, not the direct one — serverless functions exhaust direct connections.
4. Create a second branch called `dev` (Branches → New Branch, from `main`). Gives you a throwaway DB for local work so a bad migration can't touch production data. Copy its connection string too.

→ Send me both strings, or paste them into `.env` yourself (step 3).

**Alternative if you'd rather stay fully offline for now:** `brew install postgresql@17 && brew services start postgresql@17`, then `createdb pnltracker`. Connection string becomes `postgresql://localhost:5432/pnltracker`. You can add Neon later at deploy time — nothing in the code changes, only the env var.

---

## 2. 🟡 Google OAuth

1. Go to **https://console.cloud.google.com**
2. **Create project** → name it `pnltracker` → Create
3. **APIs & Services → OAuth consent screen**
   - User type: **External** → Create
   - App name: `PnL Tracker`, support email: your email
   - Developer contact: your email → Save and Continue
   - Scopes: skip (defaults are fine) → Save and Continue
   - **Test users → Add users → `t.elsay3d@gmail.com`** ← easy to miss; without it you can't log in
   - Save and Continue
   - Leave it in **Testing** mode. Do not publish — publishing triggers Google's verification review and you don't need it for a single-user app.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `pnltracker-web`
   - **Authorised JavaScript origins:**
     ```
     http://localhost:3000
     ```
   - **Authorised redirect URIs:**
     ```
     http://localhost:3000/api/auth/callback/google
     ```
   - Create → copy **Client ID** and **Client Secret**

5. **After deploying** (step 4), come back and add your production URLs to the *same* client:
   ```
   https://<your-app>.vercel.app
   https://<your-app>.vercel.app/api/auth/callback/google
   ```

⚠️ Redirect URIs must match **exactly** — no trailing slash, correct scheme. Mismatch is the single most common OAuth failure (`redirect_uri_mismatch`).

---

## 3. 🔴/🟡 Environment file

Create `.env` in the project root (already gitignored — never commit it):

```bash
DATABASE_URL="postgresql://...-pooler.ap-northeast-1.aws.neon.tech/neondb?sslmode=require"
BETTER_AUTH_SECRET="<paste output of: openssl rand -base64 32>"
BETTER_AUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="<from step 2>"
GOOGLE_CLIENT_SECRET="<from step 2>"
ALLOWED_EMAIL="t.elsay3d@gmail.com"
FINNHUB_API_KEY="<your existing key>"
```

Generate the secret:
```bash
openssl rand -base64 32
```

`ALLOWED_EMAIL` is the allowlist — any other Google account is rejected at sign-in even if OAuth succeeds. Single-user lockdown.

---

## 4. 🟢 Vercel deploy

1. Push the repo to GitHub (private)
2. **https://vercel.com/new** → Import the repo
3. Vercel **auto-detects TanStack Start** — leave build settings alone
4. **Environment Variables** → add every var from step 3, except set:
   ```
   BETTER_AUTH_URL = https://<your-app>.vercel.app
   ```
5. Deploy
6. Go back to Google Console (step 2.5) and add the production redirect URI
7. Set `DATABASE_URL` to the Neon **`main`** branch (keep `dev` for local)

---

</details>

## 5. 📄 Optional — US dividend data

Your monthly statements contain **JP dividends and fund distributions (6 payouts, ¥60,119)**, but **no US dividends** — despite you holding KO, AAPL, KMB, DVN, BKR, RIO, XLE.

Rakuten reports those separately. To include them:

> 楽天証券 → マイメニュー → 電子交付書面 → **外国株式配当金計算書**

Export and drop into `csv/statements/`. Without it, US dividend income is missing from totals. Everything else works fine.

---

## Running it

```bash
npm run dev        # http://localhost:3000
npm test           # 148 tests
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run seed       # re-import csv/ (idempotent)
npm run preview    # production build + serve
```

⚠️ Use `npm run dev`, not `npm start` — `start` serves the production build.
The dev server is pinned to port 3000 because `BETTER_AUTH_URL` is; if 3000 is
occupied, Vite would move and OAuth would fail.

## 6. 🟢 Before deploying

1. **Swap to the pooled Neon endpoint.** Your current `DATABASE_URL` is the
   *direct* endpoint. Serverless functions exhaust direct connections — use the
   host containing `-pooler` from Neon's dashboard.
2. **Rotate the database password.** It was pasted into a chat transcript.
   Neon → Roles → `neondb_owner` → Reset password.
3. **Add the production redirect URI** to the same Google OAuth client:
   `https://<your-app>.vercel.app/api/auth/callback/google`
4. **Set `BETTER_AUTH_URL`** to the deployed origin in Vercel's env vars. It
   drives both the OAuth callback and the same-origin check.
