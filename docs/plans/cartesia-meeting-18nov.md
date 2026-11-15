# Cartesia meeting, 18 Nov 2026: what to ask and what we bring (C1, 15 Nov 2026)

Owner, Track C: a short, factual brief for the call. Every number below is ours and measured (sources named); everything we do not know is a question. Nothing here is a decision.

## 1. Where Cartesia sits in Stack19

* Primary voice for calls and Talk live in te, hi, kn, en (sonic-3.6, voices in `app/conversation/data/voices.json`), with Sarvam Bulbul v4 Flash behind it as fallback (switch after an error, an empty answer, or no audio within 800 ms; 30 s cool-down). ADR 0117.
* Audio out: 24 kHz PCM, resampled to 16 kHz for the carrier (Plivo). Speech-to-text stays Sarvam (owner, 12 Nov).
* Our own pronunciation map runs in front of every voice (`app/conversation/pronounce.py`, `data/pronunciations.json`): Cartesia gets its phoneme syntax for words such as "Kannada".
* Cost control: our own cap on characters per day and per call (`public.voice_budget`, `voice_usage_days`).
* Already done (owner, 12 Nov): Cartesia training opt-out.

## 2. Our numbers (staging, 14 Nov, 57 phone turns, `scripts/call_latency_report.py`)

| stage | p50 ms | p95 ms |
|---|---:|---:|
| STT final | 193 | 253 |
| first LLM token | 708 | 872 |
| first TTS audio after the first words | 68 | 186 |
| caller's last word to first sound | 1222 | 1783 |

Target: p50 < 1.2 s, p95 < 1.5 s. Cartesia is the smallest stage (68 ms p50) so it is not where we lose time; what we want from the meeting is to keep it that way under load and to know the settings that guarantee it. Kannada was 2.5 to 3 times slower than Telugu in the browser-socket run (p50 5562 ms vs 2188 ms): the cause is not yet known (voice, prompt tokens or STT); ask whether Kannada generation has a different latency profile.

## 3. Questions

Data and legal (these feed the processors list, `docs/plans/launch-master-list.md` D16):
1. **Zero Data Retention**: can it be switched on for our account, in writing, and does it cover text, audio and logs? What is kept without it, for how long, and where?
2. Written confirmation that the training opt-out is in force for our organisation, and how it is shown in the dashboard.
3. Data region: where is audio generated and where are requests logged (we serve Indian businesses; the processors list names region and retention per processor)?
4. A Data Processing Agreement and the current sub-processor list; how are changes announced?
5. Security: SOC 2 report, incident notification time.

Quality and latency:
6. The lowest-latency settings for streaming over a websocket: model, sample rate, output format, `max_buffer_delay_ms` or its equivalent, continuations. What do you advise for 8 to 24 kHz phone use?
7. Keep one websocket warm per call, or per process? Limits on concurrent contexts per connection and per account; behaviour when we cancel a context mid-sentence (barge-in).
8. Time to first audio p50 and p95 you see for te, hi, kn, en; any difference for Kannada and Telugu; known slow periods.
9. **Pronunciation dictionary** vs our map: does the dictionary apply to te/hi/kn, can it hold phonemes, can we manage it by API per voice? Today we respell text ourselves; we would move words that work in the dictionary and keep ours for the rest.
10. Voices: stability of the voices in our catalogue over model updates (we pin by id); how long are retired voices kept?
11. **Cartesia Agents** against our own loop (STT, router, model, TTS in our code): what the end-to-end latency would be, whether we can bring our own model and our own consent and calling-hours rules, and what the free credits cover. We would benchmark it, not switch.

Commercial:
12. Pricing at our volume (characters per month), rate limits, and what happens at the limit (queue or error).
13. Status page and support channel with a response time.

## 4. What we will do with the answers

* Lever 4 of `docs/plans/call-latency.md` (streaming settings, warm websocket): apply the advised settings, measure with `scripts/call_latency_report.py` on sandbox calls, record before/after.
* Pronunciation: compare the dictionary with our map on the words in `data/pronunciations.json`; move what it does better.
* Processors list (draft until the owner approves): add retention, region and ZDR status for Cartesia.
* Cartesia Agents: a benchmark only, with the free credits, on the same spoken questions as `scripts/live_standard_eval.py --staging`.
