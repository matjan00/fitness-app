# Setting up automatic phone steps

Your phone counts steps (Health Connect, built into Android 14+). The free **HC Webhook** app sends them to a small
Supabase function, which writes **yesterday's total** into the cut plan's daily log every morning.

Steps you type in the app (**Steps added by hand**) are for steps the phone did not count, e.g. a walk without it.
They are added on top of the phone's count, also when that count arrives the next morning.

The server side is already done (function `steps-webhook`, table `step_samples`). You only set up the phone, once.

## The address and the key

They are in **`steps-webhook.local.txt`** in this project folder (on your computer only, never uploaded to GitHub).
Send them to your phone in a way that stays private, e.g. a note to yourself, and delete it afterwards. The key only
lets someone send step numbers to your log, but keep it private anyway.

## Phone setup

1. **Open HC Webhook → Grant Permissions** and allow **Steps** (just Steps is enough).
2. **Add a webhook:**
   - URL: the `URL:` line from the file.
   - Add a **custom header**: name `x-api-key`, value: the `Header value:` line from the file.
   - Format: **JSON** (the default).
   - Data types: tick **Steps** only.
3. **Sync mode: Scheduled**, keep the default times (08:00 and 21:00). The morning send settles yesterday.
4. **Save configuration.**
5. **Battery:** Android Settings → Apps → HC Webhook → Battery → **Unrestricted**. OnePlus closes background apps
   otherwise and the send would not happen.
6. **Check Health Connect is counting:** Settings → Health Connect → (Devices / Data and access → Steps). Phone step
   counting should be on, and HC Webhook listed as allowed to read Steps.

## Check it works

- In HC Webhook tap **Sync Now**, then menu (⋮) → **Webhook Log**. The newest entry should show **200** and something
  like `{"ok":true,"received":42,"days_saved":[]}`. `days_saved` stays empty until a full day has been recorded:
  the first total appears the morning after the first full day with the phone counting.
- **401** means the header name or key is wrong (no spaces, name exactly `x-api-key`).

## Good to know

- Only steps taken with the phone on you count.
- If another app also writes steps into Health Connect (e.g. a pedometer app), the two could be added together. In
  Health Connect → Steps, keep only the phone itself as a source that writes steps.
- HC Webhook looks back 48 hours, so if the phone was off one morning, the evening send still settles yesterday.
- Time zone is Europe/Warsaw (a step interval belongs to the day it started). To change it, set the Supabase edge
  function secret `STEPS_TIME_ZONE`.
