# The landing page's voices (job landing-v2, part F1)

- `clips.json`: what is said and by which voice.
  - The words are the approved design's: `~/Desktop/stack19-jobs/landing-v2/Main.dc.html`, from `HERO`, `LANGS[].line`, `BIZ[].lines` and `MEETALL`.
  - The exception is the Telugu stand-up: C1 wrote it from the English, and it is marked `draft`.
  - Voices: Telugu Ramya, English Janvi, Hindi Sanya, Kannada Disha. Drafts: Tamil Janani, Malayalam Latha, and Marathi read by Sanya.
  - The sample calls' customers: Sindhu (Telugu), Rohan (Hindi), Daniel (English). All are catalogue voices (`services/ai-api/app/conversation/data/voices.json`).
- `render.py`: renders the clips with Cartesia `sonic-3.6`.
  - Each clip comes with its word timestamps, as Opus 48 kbps in WebM plus AAC 48 kbps in MP4 for browsers without Opus.
  - Everything goes into `apps/web/public/audio/site/`, with `manifest.json` for the web.
  - Only changed clips are rendered again.
  - Run: `CARTESIA_API_KEY=… python scripts/site_voices/render.py`. The key comes from the environment (Secret Manager `sme-cartesia-api-key`) and is never printed or stored.

The manifest, one entry per clip:
```json
"hero-te": { "group": "hero", "speaker": "assistant", "lang": "te", "spoken_as": "te", "voice": {"id": "te-ramya", "name": "Ramya"}, "draft": false,
             "text": "నమస్కారం! …", "duration": 3.4, "words": [{"w": "నమస్కారం!", "start": 0.0, "end": 0.71}, …],
             "sources": [{"src": "/audio/site/hero-te.webm", "type": "audio/webm; codecs=opus"}, {"src": "/audio/site/hero-te.m4a", "type": "audio/mp4"}] }
```
- `words` are the **displayed** words (the text split on spaces), in order. Light word i from `start` to `end`, in seconds from the start of the clip.
- `groups` lists the clip ids of each scene in order:
  - `hero` and `try` (te, ta, kn, ml, hi, mr, en, the design's order);
  - `call-saree`, `call-build` and `call-coach` (the lines in order; `speaker` is `assistant` or `customer`);
  - `standup-en` and `standup-te` (7 parts each; `speaker` is the helper's name).
- Owner recordings never go in the repository.
