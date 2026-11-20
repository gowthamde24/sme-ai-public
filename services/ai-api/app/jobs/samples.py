"""The spoken samples of the job cards (owner decision 19-20 Nov 2026; he approved the spend with a cap of Rs 350): one short recording per template and language, made ONCE from the template's own example words in
the default voice, kept in the database (ops.job_samples) and played by the New job sheet.

Money first. Sarvam's price today is Rs 3.00 per 1,000 characters (sarvam.ai/api-pricing, read 20 Nov 2026). `CAP_CHARS` is the most characters ALL samples together may ever cost: 100,000 = Rs 300, below the cap the owner
gave. The cap is enforced in three places so a bug in one cannot overspend: here (the plan stops), in the run (it stops before sending), and in the database (ops_job_sample_put refuses past it). Nothing is spent for words
already recorded (the hash of the words decides), and a template that is hidden (Get paid) or never spoken (a researcher) is not recorded.

The words are the template's call lines (else its WhatsApp message read aloud) with the placeholders filled by invented words; the run goes round the business types one template at a time so it never starts with one type.
Pure code and one small database client; the voice service and the data layer are injected, so tests spend nothing."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.jobs import packdata
from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.jobs.samples")

RUPEES_PER_1000_CHARS = 3.0
CAP_CHARS = 100_000   # Rs 300 at Rs 3 per 1,000 characters
MAX_PER_RUN = 60
PERSONA_SPEAKER = "ritu"   # the default voice ("female_warm", app/voicesample/service.py SPEAKERS)
PACE, TEMPERATURE = 1.0, 0.7
LANGUAGES = ("en", "te", "hi", "kn")
# invented words for the placeholders: no real business, no real person
FILL: dict[str, dict[str, str]] = {
    "assistant": {"en": "Priya", "te": "ప్రియ", "hi": "प्रिया", "kn": "ಪ್ರಿಯಾ"},
    "business": {"en": "Sri Lakshmi Traders", "te": "Sri Lakshmi Traders", "hi": "Sri Lakshmi Traders", "kn": "Sri Lakshmi Traders"},
    "customer": {"en": "Lakshmi", "te": "లక్ష్మి", "hi": "लक्ष्मी", "kn": "ಲಕ್ಷ್ಮಿ"},
    "item": {"en": "your order", "te": "మీ ఆర్డర్", "hi": "आपका ऑर्डर", "kn": "ನಿಮ್ಮ ಆರ್ಡರ್"},
}
_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
_FILE = re.compile(r"^([a-z][a-z0-9_]{2,40})_([0-9a-f]{8})\.([a-z]{2})\.mp3$")


class CapReached(RepositoryError):
    """The database refused the sample: the characters would pass the cap."""


def spoken_text(template: packdata.JobTemplate, language: str) -> str | None:
    """What the sample says, or None when the template is never spoken (a researcher) or has no words in this language."""
    line = template.call.get(language) or template.whatsapp.get(language)
    if not line:
        return None
    fills = {name: values.get(language) or values["en"] for name, values in FILL.items()}
    text = _PLACEHOLDER.sub(lambda m: fills.get(m.group(1), m.group(0)), line)
    return " ".join(text.split())


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def file_name(template_id: str, text_sha: str, language: str) -> str:
    return f"{template_id}_{text_sha[:8]}.{language}.mp3"


def parse_file(name: str) -> tuple[str, str, str] | None:
    """(template id, first 8 hex of the words' hash, language) of a file name the API made, else None."""
    m = _FILE.match(name)
    return (m.group(1), m.group(2), m.group(3)) if m else None


def url_path(pack: str, template_id: str, text_sha: str, language: str) -> str:
    return f"/v1/job-samples/{pack}/{file_name(template_id, text_sha, language)}"


@dataclass(frozen=True)
class Item:
    pack: str
    template_id: str
    language: str
    text: str

    @property
    def sha(self) -> str:
        return sha256(self.text)

    @property
    def chars(self) -> int:
        return len(self.text)


def plan(directory: Path | None, languages: Sequence[str], *, get_paid: bool = False) -> list[Item]:
    """Every sample that could exist, round the business types: the first template of every type, then the second of every type, and so on (so a run that stops early has covered all the types)."""
    if directory is None or not directory.is_dir():
        return []
    packs: list[tuple[str, list[packdata.JobTemplate]]] = []
    for sub in sorted(p.name for p in directory.iterdir() if p.is_dir() and (p / "jobs.json").is_file()):
        jobs = packdata.for_pack(sub, directory)
        if jobs is not None:
            packs.append((sub, [t for t in jobs.templates if get_paid or t.goal != "get_paid"]))
    out: list[Item] = []
    depth = max((len(t) for _, t in packs), default=0)
    for i in range(depth):
        for pack_id, templates in packs:
            if i < len(templates):
                for language in languages:
                    text = spoken_text(templates[i], language)
                    if text:
                        out.append(Item(pack_id, templates[i].id, language, text))
    return out


class SampleStore:
    """The database's door for samples (RPCs of migration 20261231986500). Every call carries the caller's token; the database decides who may."""

    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {"SM980": CapReached})

    def listing(self, token: str) -> list[dict[str, Any]]:
        return self._rpc.array(token, "job_sample_list", {})

    def get(self, token: str, pack: str, template_id: str, language: str) -> dict[str, Any] | None:
        result = self._rpc.call(token, "job_sample_get", {"p_pack": pack, "p_template_id": template_id, "p_language": language})
        return result if isinstance(result, dict) else None

    def index(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "ops_job_sample_index", {})

    def recode(self, token: str, pack: str, template_id: str, language: str, text_sha256: str, content_type: str, audio_b64: str) -> dict[str, Any]:
        return self._rpc.object(token, "ops_job_sample_recode", {"p_pack": pack, "p_template_id": template_id, "p_language": language, "p_text_sha256": text_sha256,
                                                                  "p_content_type": content_type, "p_audio_b64": audio_b64})

    def put(self, token: str, item: Item, content_type: str, audio_b64: str) -> dict[str, Any]:
        return self._rpc.object(token, "ops_job_sample_put", {"p_pack": item.pack, "p_template_id": item.template_id, "p_language": item.language, "p_text_sha256": item.sha, "p_chars": item.chars,
                                                               "p_content_type": content_type, "p_audio_b64": audio_b64, "p_cap_chars": CAP_CHARS})


def rupees(chars: int) -> float:
    return round(chars / 1000 * RUPEES_PER_1000_CHARS, 2)


def run(store: SampleStore, tts: Any, token: str, directory: Path | None, languages: Sequence[str], limit: int, *, dry_run: bool = False, get_paid: bool = False) -> dict[str, Any]:
    """Make the missing samples, at most `limit` of them, never past the cap. `tts.synthesize(text, language, speaker=, pace=, temperature=)` is the voice service. Returns what was done and what it cost."""
    import base64

    languages = [lang for lang in languages if lang in LANGUAGES]
    done = store.index(token)
    spent = int(done.get("total_chars") or 0)
    have = {(i["pack"], i["template_id"], i["language"]): i["sha256"] for i in done.get("items", [])}
    todo = [i for i in plan(directory, languages, get_paid=get_paid) if have.get((i.pack, i.template_id, i.language)) != i.sha]
    limit = max(1, min(limit, MAX_PER_RUN))
    made: list[Item] = []
    refused = ""
    for item in todo[:limit]:
        if spent + item.chars > CAP_CHARS:
            refused = "cap"
            break
        if dry_run:
            made.append(item)
            spent += item.chars
            continue
        try:
            if getattr(tts, "name", "") == "sarvam":
                speech = tts.synthesize(item.text, item.language, speaker=PERSONA_SPEAKER, pace=PACE, temperature=TEMPERATURE)
            else:
                speech = tts.synthesize(item.text, item.language, speaker=PERSONA_SPEAKER, pace=PACE)
            store.put(token, item, speech.content_type, base64.b64encode(speech.audio).decode("ascii"))
        except CapReached:
            refused = "cap"
            break
        except Exception as exc:  # noqa: BLE001 - one failure stops the run: nothing is retried blindly with money
            logger.error("job sample stopped: %s", exc.__class__.__name__)
            refused = "error"
            break
        made.append(item)
        spent += item.chars
    new_chars = sum(i.chars for i in made)
    return {"made": len(made), "left": len(todo) - len(made), "chars_this_run": new_chars, "rupees_this_run": rupees(new_chars), "total_chars": spent, "total_rupees": rupees(spent), "cap_rupees": rupees(CAP_CHARS),
            "stopped": refused or None, "dry_run": dry_run, "items": [{"pack": i.pack, "template_id": i.template_id, "language": i.language, "chars": i.chars} for i in made]}
