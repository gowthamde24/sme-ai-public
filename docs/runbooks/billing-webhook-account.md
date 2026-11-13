# The billing webhook's own account (13 Nov 2026)

Only this account, and a business's Owner, may **settle an order** (`public.pricing_order_settle`) or credit a wallet from a payment (`public.pricing_topup_credit`). The scheduler and channel accounts cannot. The API signs in as it to apply the signed Razorpay events (`POST /v1/webhooks/razorpay-billing`). Without it configured the webhook answers 503: it never falls back to another account.

## Where the pieces are
- Database: `pricing.webhook_principals`, `app.is_billing_webhook()`, `app.operator_register_billing_webhook(email)` / `operator_remove_billing_webhook(email)` (migration `20261231630000`, pgTAP 199).
- Settings: `BILLING_WEBHOOK_EMAIL` (plain, `deploy/settings/staging/api.env`), `BILLING_WEBHOOK_PASSWORD` (secret, `deploy/settings/staging/api.secrets`: `sme-billing-webhook-password`).

## Create it (once per environment)
```
python3 -I scripts/billing_webhook_account.py create --i-know-this-changes-staging --project-ref uiallwgywitryxatcqxf
```
The password is generated at random **by the script, straight into Secret Manager**: never printed, never in a file, never in a shell variable, never in git. Run it from a checkout linked to staging. Then deploy the API so a new revision reads the secret.

## Rotate it
```
python3 -I scripts/billing_webhook_account.py rotate --i-know-this-changes-staging --project-ref uiallwgywitryxatcqxf
make deploy-staging WHAT=api
```
`rotate` makes a new random password, stores it as a new version of the secret and sets it on the account; the old password stops working at once and the running revision stops signing in until the deploy gives it the new version (webhooks answer 503 in between, and Razorpay retries). Rotate after anyone who could read the secret leaves, and at least once a year.

## Remove it
`supabase db query --linked "select app.operator_remove_billing_webhook('billing-webhook@system.example.test')"`. Orders can then only be settled by their Owner (the browser path) until a new account is registered.

## What each system account may do with money
| Account | Settle an order | Credit a wallet from a payment | Apply renewal / cancel events | Charge a call or search |
|---|---|---|---|---|
| business Owner | yes (after the checked signature) | no | no | no |
| billing webhook | **yes** | **yes** | yes | no |
| scheduler, channel agent | no | no | yes (they move no money) | yes |
