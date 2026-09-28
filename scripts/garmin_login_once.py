#!/usr/bin/env python3
"""Run this once on your own computer (not in GitHub Actions) if your Garmin account has
two-step verification (MFA) turned on. It logs in interactively — you'll get a chance to type the
6-digit code Garmin sends you — and then prints a token string.

Paste that whole token string into a GitHub secret named GARMIN_TOKENS (see GARMIN-SETUP.md).
The sync job will use it instead of your email/password, and won't hit the MFA prompt.

Usage:
    python scripts/garmin_login_once.py

Requires: pip install garminconnect
"""
import getpass
import sys


def main():
    try:
        from garminconnect import Garmin
        import garth
    except ImportError:
        print("Please install the garminconnect package first: pip install garminconnect")
        return 1

    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password: ")

    client = Garmin(email, password)
    try:
        client.login()
    except Exception as e:
        # python-garminconnect raises a specific error when MFA is required and exposes
        # resume_login()/login(..., prompt_mfa=...) depending on version; fall back to garth directly.
        msg = str(e)
        print(f"Standard login needs more info ({msg}). Trying the two-step verification flow…")
        try:
            code = input("Enter the 6-digit code Garmin just sent you: ").strip()
            client.garth.login(email, password, prompt_mfa=lambda: code)
        except Exception as e2:
            print(f"Could not log in: {e2}")
            return 1

    token = client.garth.dumps()
    print("\nLogin successful. Copy the line below (it's long) into the GARMIN_TOKENS GitHub secret:\n")
    print(token)
    print("\nDo not share this with anyone — it can be used to read your Garmin account.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
