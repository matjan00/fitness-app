# Setting up "Send to Listonic"

The grocery list (Food tab → Grocery list) has a **Send to Listonic** button. It puts every product
you have not ticked yet on one of your Listonic lists, with its amount and unit. A product that is
already on the list and not crossed off gets its amount updated instead of a second copy, so you can
send again after changing your plan in Fitatu.

It goes through the Supabase edge function `listonic` (supabase/functions/listonic), which logs into
Listonic as you. Listonic has no public API, so this uses the private one that Listonic's own web app
uses. That means:
- It can break without warning if Listonic changes their app. The button then shows the error.
- Automated access may be against Listonic's terms of service. It only touches your own lists, and
  only when you press the button.

## Step 1: Make sure you can log into Listonic with an email and password

If you normally sign in with Google or Facebook, set a password for your Listonic account first
(or check that you can log in at https://app.listonic.com with email + password).

## Step 2: Add your Listonic login as Supabase secrets

Supabase dashboard → your project → **Edge Functions** → **Secrets** → add:

| Name | Value |
| --- | --- |
| `LISTONIC_EMAIL` | The email you log into Listonic with |
| `LISTONIC_PASSWORD` | Your Listonic password |

They stay in Supabase; the app and this repo never see them.

## Step 3: Try it

Open the grocery list, press **Send to Listonic** and pick the list. The app remembers it; "change
list" under the button picks another one.

## If something goes wrong

- **"Listonic rejected the email or password"**: check the two secrets.
- **"Listonic is not set up yet"**: the secrets are missing, or the function is not deployed:
  `supabase functions deploy listonic` (see NEXT-STEPS.md for the full command on this PC).
- **"Listonic refused a request (HTTP …)"**: Listonic probably changed something. Ask Claude to look
  at `supabase/functions/listonic`.
