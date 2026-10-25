# E-mail provider: what the owner must create (job DP part 6; Resend is the chosen one and is done for staging)

Two kinds of e-mail leave Stack19: **sign-in e-mails** (confirm, magic link, reset, invitation: sent by Supabase Auth through an SMTP provider set in the project's Auth settings) and **app e-mails** (trial and plan reminders: sent by the worker through the provider's HTTP API). Both stay on the fake or the built-in sender until an account exists.

## Resend (chosen; staging is set up, see docs/runbooks/email-resend.md)
1. Account at resend.com, **a domain** (stack19.com, region Tokyo is the nearest to Mumbai), and an **API key** (sending access only).
2. DNS at Cloudflare for stack19.com, exactly the records Resend shows for the domain: an **SPF** TXT (`v=spf1 include:amazonses.com ~all` on the `send` sub-domain as Resend says), the **DKIM** TXT (`resend._domainkey`), the **MX** for the bounce address on `send`, and a **DMARC** TXT at `_dmarc` (`v=DMARC1; p=none; rua=mailto:<an address you read>` to start; tighten to `quarantine` after a week of clean reports). All DNS-only (grey cloud) in Cloudflare.
3. Turn **open and click tracking off** in the domain's settings (the e-mails carry no tracking links; tracking would add them).
4. The key goes in Secret Manager as `sme-resend-api-key`; Supabase Auth gets it as the SMTP password with `scripts/apply_auth_smtp.py` (staging only: another project needs the script's reference changed on purpose).

## Zoho ZeptoMail (the alternative, not set up)
Same shape: a Mail Agent for stack19.com in the India data centre, its **SPF** include, **DKIM** (`zmail._domainkey`) and a bounce CNAME at Cloudflare, an SMTP password for Auth (host `smtp.zeptomail.in`, port 465, user `emailapikey`) and a send-mail token for the HTTP API. A second sender class (`app/billing/zepto_sender.py`) would be needed: about 40 lines like `resend_sender.py`; ask for it if Resend is ever dropped.

## Checks, for either
Send a test message to an address you read and look at the headers: `spf=pass`, `dkim=pass`, `dmarc=pass`. Put the sender at `noreply@stack19.com` and the reply-to at `support@stack19.com` (a mailbox someone reads: Cloudflare Email Routing to your inbox is free).
