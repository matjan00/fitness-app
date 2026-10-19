# Setting up the Fitatu sync

The Food tab now shows what you log in **Fitatu**: calories, protein, carbs and fat for each whole
day. A GitHub Action logs into Fitatu as you every 2 hours, reads the last week of your diary,
adds each day up, and saves only those day totals. No meals or products are copied.

The sync starts on **20 October 2026**. Days before that keep what you logged in the app's own
diary; the Food tab still shows them. From 20 October on, Fitatu is used. Each run re-reads the
last 7 days, so changes you make to recent days in Fitatu come through too. To move the start date,
change `START_DAY` in `scripts/fitatu_sync.py`.

Fitatu has no official API, so this uses the private one that Fitatu's own website uses. That
means:
- It can break without warning if Fitatu changes their website. When a sync fails, the Food tab
  says so.
- Automated access may be against Fitatu's terms of service. It only reads your own diary, a few
  times a day.

## Step 1: Make sure you can log into Fitatu with an email and password

If you normally sign in with Google, Apple or Facebook, set a password for your Fitatu account
first. The sync can't use those sign-in buttons.

## Step 2: Add your Fitatu login as GitHub secrets

On github.com, open the repository, then **Settings → Secrets and variables → Actions → New
repository secret**. Add:

| Name | Value |
|---|---|
| `FITATU_EMAIL` | The email you log into Fitatu with |
| `FITATU_PASSWORD` | Your Fitatu password |

`SUPABASE_SECRET_KEY` is already there from the Garmin setup (see GARMIN-SETUP.md if not).

## Step 3: Run it the first time

**Actions** tab → **Fitatu sync** → **Run workflow**. After a minute or two you'll see a ✔ or ✗.
The log only shows counts, like "read 7 day(s), saved 2 change(s)". It never shows what you ate.

Open the app's Food tab. It should say "Synced from Fitatu … ago" at the top. A run today
saves nothing, because the sync starts tomorrow.

## If it fails

- **"Fitatu rejected the email or password"**: check the two secrets. If you sign in with
  Google, Apple or Facebook, see Step 1.
- **"Could not read a Fitatu day (HTTP …)"**: Fitatu probably changed something. Open an issue
  or ask Claude to look at `scripts/fitatu_sync.py`.

## Typing totals in by hand

If Fitatu is wrong for a day, you can still type totals in the cut plan's daily log (Today →
Food). What you type wins over Fitatu for that day.
