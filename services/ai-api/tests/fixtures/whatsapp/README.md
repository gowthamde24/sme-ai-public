# WhatsApp sample payloads (job CD)

Sample bodies in the shape Meta publishes for the WhatsApp Cloud API webhooks (`in_*`, `status_*`, `batch_*`, `other_*`) and for the Graph API's answers to a send (`graph_*`). They were written from Meta's documentation
(developers.facebook.com/documentation/business-messaging/whatsapp/webhooks and .../support/error-codes), **not captured from a live number**: no Meta account exists yet. The names, numbers and message ids are invented.
`tests/test_whatsapp_samples.py` signs each webhook file with a test secret and sends it through the real parser, the route and the ingest; it feeds each Graph file to the real client and adapter through an in-process transport. No network.

When the owner's test number is connected (docs/runbooks/whatsapp-test-number.md), replace or add a file here with a real payload from the "Test" button of Meta's webhook page (remove the phone number and the name first) and the same tests run on it.
