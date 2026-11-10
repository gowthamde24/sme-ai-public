# Setting a business up on Plivo (phase C)

Job 3 phase C, 10 Nov 2026. Design: ADR 0122 (addendum C). Read `docs/runbooks/plivo-inbound.md` first (the addresses, the console steps, the logs).

## The rule about documents
**Stack19 never handles a customer's documents.** Plivo's Compliance API takes the documents as an upload by the account holder, so this tooling does **not** file a compliance application and never sees a document. The business (or, for Customer Zero, the owner in the Plivo console) makes its own compliance application with Plivo, in its own name; we use only its **id** and read its **status**. Open question for Plivo (not answered by their documentation): how a business registers in its own name without an account of its own. Until that is answered, the first business is set up by hand (below).

## Two ways, same end state
A business's line is a row in `public.phone_numbers` with `provider = 'plivo'`, `account_ref` (the NAME of the secret that holds its account's Auth Token; empty for the main account) and `external_ref` (its subaccount's Auth ID; empty for the main account). The API believes a request for that line only with that token.

### A. Customer Zero by hand (no code, main account)
1. In the Plivo console, create the XML Application and link the number (`plivo-inbound.md` steps 1 to 2). The Application's Answer URL and Hangup URL are the staging API's.
2. As the operator, run the line's SQL (`plivo-inbound.md` "Switching on", step 3) with the workspace's name. `account_ref` and `external_ref` stay empty: the main account's Auth Token signs, the secret `sme-plivo-auth-token`.

### B. A business with its own subaccount (the tool)
Needs: the business's compliance application **accepted** (its id), a number the operator names, the main account's Auth ID and Auth Token in the environment (an env file you source; never an argument), `gcloud` logged in as the operator.
```
PLIVO_AUTH_ID=... PLIVO_AUTH_TOKEN=... python3 scripts/plivo_onboard.py --tenant <workspace id> --business "Padma Silks" \
   --compliance-id <accepted application id> --public-base https://sme-api-620338396268.asia-south1.run.app            # a DRY RUN: says what it would do
... same line plus  --number +91XXXXXXXXXX --execute                                                                    # does it (the number's monthly rent is charged)
```
Steps (each skips itself when done, so an interrupted run is run again; add `--subaccount-id` / `--application-id` from the first run's output):
1. the compliance application must be `accepted`, else it stops and says so (nothing is bought);
2. a subaccount; its Auth Token goes **straight into Secret Manager** as `sme-ws-<workspace id>-plivo-token` (on gcloud's stdin; never printed, never in an argument);
3. the number you named is rented into the subaccount, backed by that application (**costs money**; never picked for you: without `--number` it only lists numbers on offer);
4. an XML Application under the subaccount with the staging API's answer and hangup addresses;
5. the number is linked to the Application;
6. it prints the SQL for the line (inbound OFF until the first test call has passed; then `update ... set inbound_on = true`).
The API reads the subaccount's token by the `account_ref` name (`WORKSPACE_SECRETS=gcp`; `sme-api-run` already reads `sme-ws-*` secrets only) and places calls for that line with the subaccount's own Auth ID and token.

## Why a script and not an endpoint
The API has no operator sign-in (operator work is SQL and runbooks today), and a web request that can rent numbers should not exist before one does. If the owner wants a screen, it needs an operator role first.

## Not proven on a real account
The REST shapes of number search, purchase, Application and link follow Plivo's documentation but were never run on a real account: the first run is the check, and it is a dry run unless `--execute`. Also unknown: which token signs a subaccount's Application callbacks (the SDK says "(Sub)Account auth token", which is what this uses), and whether the main account's credentials may place a call from a subaccount's number (this uses the subaccount's own).
