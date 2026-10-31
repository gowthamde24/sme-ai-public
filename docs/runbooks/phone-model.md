# Which model speaks on a phone call

Owner decision 31 Oct 2026: test Sarvam 105B on casual phone turns against Haiku 5.5 on the same set, and report. Tool: `scripts/phone_llm_bench.py` (reads the keys from Secret Manager into memory, talks straight to each provider, no Cartesia, about 200 requests). Report of the run: `~/Desktop/stack19-jobs/phone-calls-check/llm-bench.md`.

| | Haiku 5.5 | Sarvam 105B |
|---|---|---|
| first token p50 / p95 (from a Mac in India) | ~590 ms / ~850 ms | ~265 ms / ~580 ms |
| whole short reply p50 | ~990 ms | ~640 ms |
| phone rules kept (caller's language and script, short, no "sir/madam", never claims to be a person, no price or promise) | all | all of the replies it gave |
| requests that never answered | 0 | 6 to 10 of 66 (9 to 15 %): HTTP 503 or a connection that hangs until the 30 s client timeout |
| price row | `LLM_INPUT/OUTPUT_MICROS_PER_MTOK` = 9,000,000 / 45,000,000 (staging) | `SARVAM_CHAT_INPUT/OUTPUT_MICROS_PER_MTOK` = 15,000,000 / 60,000,000 |

**Conclusion.** Sarvam is about 320 ms faster to the first word and writes the same quality of short phone replies. But roughly one request in ten does not answer, and the failure is a 30-second hang, which on a phone is half a minute of silence. So:

* `TELEPHONY_LLM=haiku` (default): Haiku speaks. Steady.
* `TELEPHONY_LLM=sarvam`: Sarvam speaks behind `FirstTokenFallback` (`app/telephony/model.py`): if no first piece of text arrives within `TELEPHONY_FIRST_TOKEN_MS` (1200 ms), the same turn goes to Haiku at once and the stalled request is closed. With a 10 % stall rate the average first word is ~420 ms (against 590) but the worst turns take ~1.8 s (against ~0.85 s). Worth switching only if Sarvam's stalls are rarer from the Cloud Run region than from a Mac; measure there first (the service has no Sarvam stall counter yet: `phone_model_fallback` is logged with a count only).

The browser Live talk keeps using Haiku (its fast tier is unchanged).
