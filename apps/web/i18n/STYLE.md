# Telugu, Hindi and Kannada: style brief

One page. It tells whoever writes or proofreads a string how it should sound. English is the source;
the three other languages are **machine-written drafts** until the owner marks them reviewed
(see "Status" at the end). This describes a style, not any other product.

## Same rules in all three languages

- **Tone.** Spoken-written: the way a shop owner would type a message to a staff member or a supplier.
  Warm, plain, direct. Not a notice board, not a government form.
- **Sentences.** Short. One idea each. If a sentence needs a second "which" or "that", split it.
- **"You".** The polite everyday form, never the very formal one and never the casual one:
  Telugu *మీరు* (verbs in *-ండి*), Hindi *आप* (*-इए / -ें*), Kannada *ನೀವು* (verbs in *-ಿ / -ಿರಿ*).
- **Business and tech words.** Words people already say in English stay as people say them, written in
  the native script: quote, order, draft, follow-up, payment, advance, lead, message, WhatsApp,
  settings, password, login, privacy, GST. Do not replace them with a Sanskrit-origin or "pure" word.
  Latin letters are kept only for names and codes people read in Latin: *GST, UPI, CSV, AI, 3D, WhatsApp
  (Hindi)*. The glossary (`i18n/review/i18n-glossary.csv`) gives, for each term, a formal option (A), an
  everyday option (B) and the English-in-script option (C), with the recommended one marked.
- **Where a plain native word exists, use it.** Money coming back is "paisa wapas", not "refund
  processing". "Write it down" beats "record the entry".
- **Avoid.** Bookish or Sanskritised words (*సందేశం, आमंत्रण पत्र, ನಿರ್ಧಾರ* for "message, invitation
  letter, decision"); long compound words; passive "is sent / is recorded" chains; government-form phrasing
  (*దయచేసి, कृपया, ದಯವಿಟ್ಟು* at the start of every instruction); stacking three nouns in a row.
- **Honest wording stays.** Nothing says or hints that the system sends, pays or decides. A draft is
  approved by a person and sent by a person outside the system. Numbers and money are never rewritten.
- **Placeholders** such as `{amount}`, `{name}`, `{n}` are kept exactly. A test checks them.
- The notice "machine-written, owner to proofread" stays visible until the language is reviewed.

## Telugu (te)

Use *మీరు ... చేయండి / చూడండి*; "ok chesi" is natural (*ఓకే చేయండి*), *ఆమోదించండి* is not. Say *జవాబు*, not
*సమాధానం*; *రాసుకోండి*, not *నమోదు చేయండి*; *పంపాను*, not *పంపించబడింది*. Prefer *-కి* over *-కు* in speech.

| Formal (before) | Everyday (now) |
|---|---|
| మీ బ్యాంకులో డబ్బు కనిపించినప్పుడు మాత్రమే నమోదు చేయండి. | డబ్బు మీ బ్యాంక్‌లో కనిపించాకే రాసుకోండి. |
| డ్రాఫ్ట్, పంపలేదు. ఆమోదిస్తే అది పంపబడదు. | డ్రాఫ్ట్, ఇంకా పంపలేదు. ఓకే చేసినంత మాత్రాన పంపరు. |
| సేవను చేరుకోలేకపోయాం. మీ కనెక్షన్ చూసి మళ్ళీ ప్రయత్నించండి. | సర్వీస్‌కి కనెక్ట్ కాలేకపోయాం. మీ ఇంటర్నెట్ చూసి మళ్ళీ ప్రయత్నించండి. |

## Hindi (hi)

Use *आप* with *-ें / -इए*; avoid *कृपया* as a habit. Say *मैसेज*, not *संदेश*; *पेमेंट / एडवांस*, not
*भुगतान / अग्रिम*; *ग्राहक* is fine for customer; *जवाब*, not *उत्तर*. Write *लिख लें*, not *दर्ज करें*.
Keep the spelling people type (*ईमेल, लॉग इन*), not the dictionary form (*ई-मेल, प्रवेश करें*).

| Formal (before) | Everyday (now) |
|---|---|
| तभी दर्ज करें जब आपके बैंक में पैसा दिख जाए। | पैसा बैंक में दिख जाए, तभी लिखें। |
| अभी भी रुका पैसा: {amount}। ग्राहक को रिफ़ंड देना बाकी हो सकता है। | हमारे पास रुका पैसा: {amount}। ग्राहक को पैसे वापस करने पड़ सकते हैं। |
| हम सेवा तक नहीं पहुँच सके। अपना कनेक्शन जाँचकर फिर कोशिश करें। | सर्विस से कनेक्ट नहीं हो पाए। अपना इंटरनेट देखकर फिर कोशिश करें। |

## Kannada (kn)

Use *ನೀವು* with the *-ಿ* imperative (*ನೋಡಿ, ಕೊಡಿ*). Say *ಮೆಸೇಜ್*, not *ಸಂದೇಶ*; *ಉತ್ತರ* is fine for reply;
*ಒಪ್ಪಿಗೆ ಕೊಡಿ*, not *ಅನುಮೋದಿಸಿ*; *ಬರೆದುಕೊಳ್ಳಿ*, not *ದಾಖಲಿಸಿ*; *ಹಣ ವಾಪಸ್ ಕೊಡುವುದು*, not *ರೀಫಂಡ್ ಪ್ರಕ್ರಿಯೆ*.
Do not use the *-ಲ್ಪಡು* passive (*ಕಳುಹಿಸಲ್ಪಡುವುದಿಲ್ಲ*); say who does it, or use the active verb.

| Formal (before) | Everyday (now) |
|---|---|
| ಡ್ರಾಫ್ಟ್, ಕಳುಹಿಸಿಲ್ಲ. ಅನುಮೋದಿಸಿದರೆ ಅದು ಕಳುಹಿಸಲ್ಪಡುವುದಿಲ್ಲ. | ಡ್ರಾಫ್ಟ್, ಇನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ. ಒಪ್ಪಿಗೆ ಕೊಟ್ಟರೆ ಕಳುಹಿಸುವುದಿಲ್ಲ. |
| ಇನ್ನೂ ಉಳಿಸಿಕೊಂಡಿರುವ ಹಣ: {amount}. ಗ್ರಾಹಕರಿಗೆ ರೀಫಂಡ್ ಕೊಡಬೇಕಾಗಬಹುದು. | ನಮ್ಮ ಬಳಿ ಇನ್ನೂ ಇರುವ ಹಣ: {amount}. ಗ್ರಾಹಕರಿಗೆ ಹಣ ವಾಪಸ್ ಕೊಡಬೇಕಾಗಬಹುದು. |
| ಇಲ್ಲ. ಪ್ರತಿ ಸಂದೇಶವೂ ಡ್ರಾಫ್ಟ್. ... ಏನೂ ತಾನಾಗಿ ಕಳುಹಿಸಲ್ಪಡುವುದಿಲ್ಲ. | ಇಲ್ಲ. ಪ್ರತಿ ಮೆಸೇಜ್ ಡ್ರಾಫ್ಟ್ ಮಾತ್ರ. ... ಏನೂ ತಾನಾಗಿ ಹೋಗುವುದಿಲ್ಲ. |

## How the owner's choices get in (status)

Every string in `apps/web/i18n/strings/*.json` has a status per language: `draft` or `reviewed`.

1. `npm run i18n:export` writes the review sheet (`~/Desktop/i18n-review.csv`): one row per string and language.
2. The owner types a fix into **owner-edit**, or sets **status** to `reviewed` to accept a draft as it is.
3. `npm run i18n:import -- <sheet.csv>` writes the edits back and marks those strings `reviewed`.
4. `npm run i18n:status` (also part of `npm run build`, so of `npm run check`) prints the draft count per language.
   With `PUBLIC_LAUNCH_REQUIRES_REVIEWED=1` the build fails while any string is still a draft. It is not set by default.
