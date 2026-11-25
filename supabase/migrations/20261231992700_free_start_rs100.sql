-- Owner decision 25 Nov 2026 (planner, 26 Nov): the free start of a person who proved a phone is Rs 100 (10000 paise). The settings row held Rs 50 (5000) from the first build, so the opening of sign-up would have
-- granted half of what the owner decided. It is declared here, not a hand edit, so a fresh database and production end up the same. The e-mail-only credit (Rs 30, `signup.settings.email_only_paise`) is a separate setting.
update pricing.settings set free_start_paise = 10000;
