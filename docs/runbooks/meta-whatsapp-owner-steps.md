# WhatsApp on staging: what the OWNER clicks and types (Meta app 1407102551140162, test number +1 555 188 6186)

Ids: App `1407102551140162`, WhatsApp Business Account `1421890996429034`, phone number id `1329673453571780`, Graph API v25.0. The API is `https://sme-api-620338396268.asia-south1.run.app`. Nothing secret is in this file: the token and the verify token live in Secret Manager (project `project-2757c07e-37d2-4167-88f`).

## 1. A System User token that never expires (the permanent token for staging, and later production)
1. Open **business.facebook.com > Business settings** for the Stack19 business.
2. **Users > System users > Add**. Name it `stack19-whatsapp`, role **Admin**, Create.
3. Select it > **Add assets**:
   - **Apps** > the Stack19 app > turn on **Manage app** (full control) > Save.
   - **WhatsApp accounts** > the Stack19 WABA `1421890996429034` > **Manage WhatsApp Business Account** (full control) > Save.
4. **Generate new token** > choose the Stack19 app > **Token expiration: Never** > tick **whatsapp_business_messaging** and **whatsapp_business_management** > **Generate token**. Copy it once.
5. Store it WITHOUT showing it anywhere else (a hidden prompt on your own Mac; nothing is echoed or saved in history):
   ```
   read -rs WA_TOKEN; printf %s "$WA_TOKEN" | gcloud secrets versions add sme-whatsapp-token --data-file=- --project project-2757c07e-37d2-4167-88f; unset WA_TOKEN
   ```
   Type or paste the token, press Return (nothing appears), done. The staging API reads `latest` at run time; no deploy is needed.

## 2. The webhook (Configure webhooks)
1. **developers.facebook.com > the Stack19 app > WhatsApp > Configuration > Webhook > Edit.**
2. **Callback URL:** `https://sme-api-620338396268.asia-south1.run.app/v1/webhooks/whatsapp`
3. **Verify token:** print it in YOUR terminal (never in chat) and paste it into Meta:
   ```
   gcloud secrets versions access latest --secret sme-whatsapp-verify-token --project project-2757c07e-37d2-4167-88f; echo
   ```
4. **Verify and save**, then **Manage** and subscribe the field **messages** (delivery and read statuses arrive in the same field). Nothing else is needed for staging.

## 3. Your sandbox numbers
In the app's **WhatsApp > API Setup > To**, add your own number(s) (up to 5; you receive a code on each). The API sends only to the numbers in its own fence (`WHATSAPP_ALLOWED_RECIPIENTS`); C1 never asks for numbers in chat.

## 4. See it work
Message the test number from your phone (any text). In the staging app, sign in as the **Stack19 Owner Test** workspace: the message is a new lead with a conversation under **Chats / Lead Desk**; reply from there (a reply inside the 24-hour window is a plain text; outside it only an approved template goes). A STOP from your phone stops everything to your number.

Status of the C1 side (13 Nov, 10:44 UTC): `hello_world` was sent from the test number to your allow-listed number through the Cloud API (HTTP 200) and Meta's delivery status for it reached the staging webhook within seconds (recorded in `integrations.wa_events`, kind `status`). The reply from your phone is the part only you can do.
