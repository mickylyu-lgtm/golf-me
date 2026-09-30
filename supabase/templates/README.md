# Supabase Auth email templates

Supabase Auth sends GolfMe's sign-in emails itself, through the custom Resend SMTP set up in the Dashboard. The template text lives **only in the Supabase Dashboard**: there is no `config.toml` here, and nothing in the app code sends these emails. This folder is the tracked copy, so the design can be reproduced or restored from any device.

## `sign-in-email.html`

Used for **two** Dashboard templates, because Supabase picks one depending on the account:

| Dashboard template | Sent when | Subject |
|---|---|---|
| **Magic link** | an existing user asks for an email sign-in link | `Sign in to GolfMe` |
| **Confirm signup** | a new email is used on "Continue with Email" for the first time | `Sign in to GolfMe` |

### Applying it

1. Supabase Dashboard → project **GolfMe** → **Authentication** → **Emails** → **Templates**.
2. Open **Magic link**. Set **Subject** to `Sign in to GolfMe`, replace the whole **Body** with the contents of `sign-in-email.html`, and save.
3. Open **Confirm signup** and do the same: same subject, same body.
4. Test: request a link from the app and check the email arrives, the button and the fallback link both sign you in, and it reads well on your phone.

### Rules for editing

- The link must come only from `{{ .ConfirmationURL }}` (button and fallback). Never hard-code a URL: Supabase builds it with the one-time token and the app's redirect (`com.golfme.ios://auth-callback` in the iOS app, the site origin on the web).
- Design: corporate transactional layout (2026-09-30): thin gold + forest accent line, small logo and wordmark top-left, left-aligned copy in a 600 px column, a forest-green 48 px button with 8 px corners, fallback link, then a separate grey footer (GolfMe, golfme.app, Support · Privacy Policy · Terms of Service, automated-email note, copyright). Colors are the brand anchors from `src/index.css` (`--color-brand-forest` #1b4a2d, `--color-brand-gold` #f0b93f).
- Layout is tables + inline styles on purpose: Gmail drops most `<style>` rules. The `<style>` block only adds the dark-mode version for clients that support it (e.g. Apple Mail). Outlook desktop ignores rounded corners, so the button is square there, which is fine.
- Update the footer year (© 2026) each January.
- The logo loads from `https://golfme.app/icons/icon-192-v3.png` (PNG, since email clients don't render SVG). If that file is renamed or removed, update this template, or the logo disappears from sign-in emails. The logo has empty alt text because the "GolfMe" wordmark sits right beside it, so the email still reads correctly with images blocked.
- The copy ("expires shortly", "can only be used once") matches Supabase's default link expiry and one-time use; revisit it if the expiry setting changes.
