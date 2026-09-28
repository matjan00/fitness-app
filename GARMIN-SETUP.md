# Setting up automatic Garmin sync

Your runs now sync from Garmin Connect automatically, for free — a robot (a "GitHub Action") logs
in as you every 3 hours, downloads your new runs, and saves them so the app can show them. You
only need to do this setup once.

This uses an **unofficial** way of talking to Garmin (there's no free official one), so two things
to know up front:
- If your Garmin account has **two-step verification** (a code texted or app-generated at login),
  see the "Two-step verification" section below — a couple of extra steps are needed.
- Garmin can occasionally block automated logins for a while if they happen too often. The job
  only runs every 3 hours and is gentle, so this should be rare, but if a sync fails you'll see a
  short message in the app (see "How to see if it worked" below) rather than it failing silently.

## Step 1 — Add your Garmin login as GitHub secrets

Secrets are values GitHub stores privately for your repository — they never show up in the code,
and nobody browsing the repo can see them.

1. Open your repository on github.com (matjan00/fitness-app).
2. Click **Settings** (top menu of the repo — not your personal account settings).
3. In the left sidebar, click **Secrets and variables → Actions**.
4. Click the green **New repository secret** button.
5. Add these one at a time (click "New repository secret" again for each):

   | Name | Value |
   |---|---|
   | `GARMIN_EMAIL` | The email you log into Garmin Connect with |
   | `GARMIN_PASSWORD` | Your Garmin Connect password |
   | `SUPABASE_SECRET_KEY` | See Step 2 below |

   For each one: type the **Name** exactly as shown (capital letters matter), paste the **Value**,
   then click **Add secret**.

## Step 2 — Get your Supabase secret key

This lets the sync job save your runs to the same database the app reads from.

1. Go to [supabase.com](https://supabase.com) and open your project (`txhcnqwrdazgaxjwabln`).
2. Click **Project Settings** (gear icon, bottom of the left sidebar).
3. Click **API Keys**.
4. Under **Secret keys**, click to create one if none exists, then copy it. It's a long string
   starting with something like `sb_secret_...` or `eyJ...` — copy the whole thing.
5. Paste it as the `SUPABASE_SECRET_KEY` secret in Step 1 above.

Keep this key private — it can read and write all the data in your Supabase project. Never put it
in the app's own files (those are public); it only ever goes into the GitHub secret.

## Step 3 — Run it for the first time

1. On github.com, open your repository and click the **Actions** tab.
2. In the left list, click **Garmin sync**.
3. Click the **Run workflow** button (top right), then click the green **Run workflow** button
   that appears.
4. Wait a minute or two, then refresh the page — you'll see a run appear with a ✔ (success) or ✗
   (failed). Click it to see the log if you want details (it never shows your actual data, just
   counts and short messages).

The first sync pulls your last 6 months of runs, so it may take a few minutes. After that it runs
automatically every 3 hours and only checks the last 3 weeks (much faster).

## How to see if it worked

Open the app, go to the **Run** tab (or **Me → Running**). You'll see:
- *"Synced automatically from Garmin every 3 hours · last sync ... · N runs"* — it's working.
- *"Setup: add your Garmin login as GitHub secrets — ask Claude"* — the job hasn't run successfully
  yet (do Steps 1–3 above).
- A short error message — something went wrong; see "Two-step verification" below if it mentions
  that, otherwise double-check the secret values in Step 1 are correct (no extra spaces, right
  account).

There's also a **Refresh** button on the Run tab — it just re-checks the database for whatever the
scheduled job already saved; it doesn't talk to Garmin itself.

## Two-step verification

If logging into Garmin Connect normally asks for a 6-digit code (from a text message or an app),
the automated job can't handle that popup — so instead you generate a login token once, yourself:

1. On your own computer, open a terminal in the project folder and run:
   ```
   pip install garminconnect
   python scripts/garmin_login_once.py
   ```
2. It will ask for your Garmin email, password, and then the 6-digit code — type them in.
3. It prints a long token string. Copy the **entire** line.
4. Add it as a new GitHub secret (Step 1 above) named `GARMIN_TOKENS`.

The sync job checks for `GARMIN_TOKENS` first and uses it instead of your email/password, so it
skips the two-step prompt entirely. This token can expire after a while (Garmin doesn't publish
exactly when) — if sync starts failing again with a login error, just repeat these steps to get a
fresh token.

## Limitations, in plain terms

- This isn't an official Garmin feature — it logs in the same way you would in a browser. It has
  worked reliably for a long time for many people, but Garmin could change something that breaks
  it; if so, ask Claude to fix it.
- Splits, laps and "best effort" times (fastest 1k, 5k, etc.) are calculated approximately from
  Garmin's per-kilometre laps, since Garmin doesn't expose the same second-by-second best-effort
  data Strava did. They're marked as approximate internally and should still be close.
- The sync only looks at running activities (including treadmill and trail runs) — other sports
  are skipped.
