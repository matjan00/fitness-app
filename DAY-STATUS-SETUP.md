# Blocking X and Instagram after a red day

Every morning your phone asks the app how yesterday went. If it was a **red day**, X and Instagram close
themselves for the rest of the day. Green and yellow days change nothing.

How it works: the Supabase function `day-status` works out yesterday's status with the same rules as the Today
card (weigh-in, 15 km, 7.5 h sleep, week on track for 3 gym sessions), from the data the app has synced. The free
**MacroDroid** app asks it at 08:15, after the phone steps arrive at 08:00. Your apps are blocked until 09:00 anyway,
so there's no gap.

## 1. Server (once, on the PC)

1. **Make a key.** In PowerShell in the project folder:

   ```powershell
   $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $_.ToString('x2') })
   ```

   Save it in a file **`day-status.local.txt`** in the project folder, which never goes to GitHub:

   ```
   URL: https://txhcnqwrdazgaxjwabln.supabase.co/functions/v1/day-status?format=text
   Header name: x-api-key
   Header value: <the key>
   ```

2. **Add the secret:** Supabase dashboard → your project → **Edge Functions** → **Secrets** → add
   `DAY_STATUS_KEY` = the key.

3. **Deploy the function** (bundled npx, because the global npx on this PC is broken):

   ```powershell
   & "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js" --yes supabase@2.118.0 functions deploy day-status --no-verify-jwt --project-ref txhcnqwrdazgaxjwabln --use-api
   ```

4. **Check it:**

   ```powershell
   curl.exe -H "x-api-key: <the key>" "https://txhcnqwrdazgaxjwabln.supabase.co/functions/v1/day-status"
   ```

   You should get something like `{"day":"2026-11-14","status":"green","red":false,"checks":[...]}`, matching what
   the app shows for yesterday. `?day=2026-11-10` checks an earlier day, and `?format=text` returns just `red`,
   `yellow` or `green` (that's what the phone uses).

## 2. Phone (once, in MacroDroid)

Install **MacroDroid** from the Play Store. The free version allows 5 macros, and this uses 3.
Menu names below may be worded slightly differently in your version.

**Macro 1: "Check yesterday"**
- Trigger: **Date/Time → Day/Time Trigger**, 08:15, every day.
- Action: **Connectivity → HTTP Request**
  - Method GET, URL = the `URL:` line from the file (ending in `?format=text`).
  - Headers: add `x-api-key` = the `Header value:` line.
  - **Save response** (body) to a new **string** variable `day_status` (global).
- Tap **Test macro** once; `day_status` (in Variables) should show `green`, `yellow` or `red`.

**Macro 2: "Red day block"**
- Trigger: **Applications → Application Launched/Closed → Launched**, pick **X** and **Instagram**.
- Constraint: **MacroDroid specific → Variable value**: `day_status` equals `red`.
- Actions:
  1. **Applications → Launch Home Screen** (sends you back out of the app).
  2. **Notification → Popup Message**: `Red day yesterday. Earn it back today.`

**Macro 3: "Reset at midnight"**
- Trigger: **Day/Time Trigger**, 00:00, every day.
- Action: **Variables → Set Variable**: `day_status` = empty text.

**Battery:** Android Settings → Apps → MacroDroid → Battery → **Unrestricted**. Also allow MacroDroid's
**Accessibility** service when asked; that's how it sees which app opened. Without these, OnePlus closes it in
the background.

## Good to know

- **Fixed yesterday's log late?** (e.g. typed in sleep at 10:00.) Run Macro 1 again with **Test macro**, or add a
  second trigger at 12:00. It re-checks and unblocks if the day is no longer red.
- **No internet at 08:15:** `day_status` isn't set to `red`, so nothing is blocked that day.
- **Not blocked:** X and Instagram in the browser. Add the websites to your existing 9 am block if that matters.
- MacroDroid can be switched off, so this is a nudge, not a lock. For something harder to get round, a blocker with a
  strict mode or a PIN can be added later.
