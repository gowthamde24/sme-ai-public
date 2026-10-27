# Contract: the voice picker's listening sample (job DS; answer to C2's question 3)

`GET /v1/tenants/{t}/ai-assistant/voice-sample?voice=<female_warm|female_clear|male_calm|male_lively>&language=<en|te|hi|kn|ta|ml>&style=<warm|quick>&name=<optional, 1 to 24 characters, no < > { } @ / \ |>`

- **Who:** Owner and Admin (the browser never sees the token: the web route proxies it).
- **Answer:** the SOUND itself, `audio/wav`, at most 2,000,000 bytes, `Cache-Control: private, max-age=3600`. The words are the assistant's opening line in the everyday spoken style, saying it is an AI assistant, with the chosen name (default "Vijaya") and the workspace's business name.
- **404 `no_sample`:** there is none: the voice is synthetic (the fake engine) or voice is switched off on this system. The screen should then say so (keep the mock sound).
- **429 `rate_limited`** with `Retry-After`: six samples a minute per workspace, and a daily cap on the characters sent to the voice service per workspace (Sarvam credits are limited). A sample already made for the same workspace, voice, language, style and name is served from a 24-hour cache and costs nothing.
- **422** for a voice, language or style outside the lists, or a bad name.
- `style=warm` is a normal pace, more expressive; `style=quick` is faster and steadier. Listening only: nothing is saved (the saved `style` of the assistant is unchanged).
- Speakers on Sarvam: female_warm = ritu, female_clear = priya, male_calm = aditya, male_lively = rahul (chosen by name; a native listener should confirm which suit).
