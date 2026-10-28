"""Competitor parity (job DT, landing-v2 job C1 part 2; ~/Desktop/stack19-jobs/parity-matrix.md says for each feature what is built, what is a stub and what is missing).

Telephony is not live, so every module here is PURE logic (decisions, plans, formats) with a FAKE backend behind a small interface: it is tested, it is what a real provider adapter will call, and none of it dials,
sends or stores anything by itself. Nothing here weakens a consent, calling-hours, DND or disclosure rule: those stay where they are (callsettings, outreach, opening)."""
