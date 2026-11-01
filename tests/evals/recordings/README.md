# Recordings evals: the owner's real voice (31 Oct 2026)

Eight consented, test-only recordings of the owner (Telugu, Tenglish, English) were played through our speech recogniser and the turn-taking loop. **No audio is in the repository, here or anywhere else, and none is to be added.**
What is kept is text and timings: what the recogniser wrote for each piece, how long each piece and each pause were, and what the audio turn model said (its chance that the turn was over) at each stop.

`cases.jsonl`, one line per recording: `segments` (the recogniser's pieces: `text`, `speech_ms`, `gap_ms` = the quiet that followed before the speaker went on; `inferred: true` = timing not observed), `audio_p_at_stops`,
`expect_joined` (what the loop must hand to the assistant as ONE turn), `status` (`pass` today, or `known_gap` with a `gap` sentence) and `reference_unconfirmed` (the recogniser's whole-piece transcript; the owner has not confirmed the truth yet).

`tests/test_or_recordings_eval.py` replays the pieces through the real loop with a scripted recogniser: text rules alone must join every `pass` case; every `known_gap` is a strict expected failure for the text rules (when a fix lands the test
flips and the line is changed to `pass`), and with the audio turn model at the calibrated threshold the gaps that its numbers can fix are checked.

`interruptions.jsonl`: the barge-in windows of voices 5 and 6 (1.5 s slices) with what the recogniser wrote, the sound's length, its level, the OWNER'S label (`owner`, `tv`, `cough`), what the reply should do (`stop` / `ignore`) and `status`. Two TV phrases of two or more words are known gaps (they stop the reply).

Barge-in decisions of the windows are scored with the language gate on the owner's pill (`pin`: Telugu). The gate's honest limit is in `docs/runbooks/live-conversation-standard.md`: the pinned recogniser writes English in Telugu script, so the text-based gate rarely fires in a real session.

Labels corrected 1 Nov 2026 (the owner re-listened): in voice 6 everything with speech is the owner; only the music at 0 to 1.5 s ("Cubic") is not. `speaker_scores_voice6.json` holds the speaker check's numbers for it (music 0.06, the owner 0.58 to 0.76).
