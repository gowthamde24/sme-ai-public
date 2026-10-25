# The native-review kit (job DL)

How the owner gets the Telugu, Hindi and Kannada texts read by native speakers, and how their corrections come back. The first versions of those texts are machine drafts (`i18n/STYLE.md`).

## Send out
```
cd apps/web && npm run i18n:kit-export          # writes ~/Desktop/stack19-jobs/review-kit/{te,hi,kn}/ and HOW-TO-REVIEW.{md,html}
npm run i18n:kit-export -- --out DIR --lang te   # one language, anywhere
```
Per language, `review-<lang>.csv` (Excel, Sheets) and `review-<lang>.html` (prints, A4 landscape), with the columns `key`, `English`, `current draft`, `corrected`, `comment`, `where it appears (page)`. Send the sheet and `HOW-TO-REVIEW.html` (one page) to the reviewer.

What is in a sheet (545 texts): the home page texts and the sample chat in that language; the Privacy Policy and the data-deletion page (every paragraph, list item and table cell, with their short summaries); the sign-up and sign-in screens; and the 200 app strings most screens show. "Most seen" = the number of app screens whose text contains the string (the plain-text snapshots in `apps/web/test/screens/__text__`), with the menu and top bar (on every screen) first. No usage counting exists yet; when it does, replace `rankAppStrings` in `apps/web/scripts/lib/review-kit.mjs`.

## Take back
```
npm run i18n:kit-import -- --lang te ~/Downloads/review-te.csv --dry-run     # checks only
npm run i18n:kit-import -- --lang te ~/Downloads/review-te.csv               # writes
npm run i18n:kit-import -- --lang te ~/Downloads/review-te.csv --mark-unchanged-reviewed   # also: every row left empty counts as read and fine
```
Nothing is written unless the whole sheet passes: `{tokens}` kept exactly (also the legal `{brand}`, `{privacy_email}`…), no empty or space-only correction, no bookish word (`te అభ్యర్థన`, `hi अनुरोध`, `kn ಮನವಿ`), no claim from `i18n/strings/forbidden.ts`, the `current draft` still the repository's text (a stale sheet is refused; `--allow-stale` overrides), no key twice, no key of another language. A sentence written more than once in a legal file must carry the same correction in each row.

Written: corrections go into `i18n/strings/{site,login,signup,legal,app}.json` with `status.<lang> = "reviewed"` (a sample chat, the same text in all four dictionaries, is written in all four), and into `lib/legal/{privacy,data-deletion}-text.<lang>.ts` by replacing the exact string. The legal texts have no status field, so the ids of the sentences a reader has been through are listed in `i18n/review/legal-reviewed.json` (`{ "privacy": { "te": ["intro.0", …] } }`). The reviewer's comments are printed, never applied.

After an import run the web tests (`npm test`): they check placeholders, scripts, forbidden claims and the legal texts' shape. `npm run i18n:status` counts the drafts that remain in `site`, `login` and `app` (it does not read `signup` or `legal`; the kit does).
