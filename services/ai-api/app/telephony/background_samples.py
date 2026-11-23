"""The background-sound previews (docs/contracts/voice-styles.md section 2): `GET /v1/background-samples/<id>.mp3`, a 6 s voice-free loop per sound, pre-recorded once (scripts/make_background_previews.py) and committed.

Public by design like the voice and style previews (a browser audio tag fetches it without a sign-in; it holds no data about anyone), rate limited (rule background_samples), cached for a year: a sound's file only changes
with a new file name's content, and the screen always asks for the id it was given. Only an id of `ambience.BACKGROUNDS` other than `off` becomes a path: nothing the caller types reaches the file system."""

# ruff: noqa: E501

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import FileResponse, Response

from app.errors import ApiError
from app.telephony import ambience

router = APIRouter(prefix="/v1/background-samples", tags=["ai-assistant"])
PREVIEWS = ambience.DATA / "previews"
SAMPLE_URL = "/v1/background-samples/{id}.mp3"


def sample_url(sound: str) -> str | None:
    """The preview address of a sound, null for Off and for a sound whose file is missing (the screen then shows no Play button rather than a dead one)."""
    if sound == "off" or sound not in ambience.BACKGROUNDS or not (PREVIEWS / f"{sound}.mp3").is_file():
        return None
    return SAMPLE_URL.format(id=sound)


@router.get("/{file_name}")
def background_sample(file_name: str) -> Response:
    sound = file_name[:-4] if file_name.endswith(".mp3") else ""
    if sound not in ambience.BACKGROUNDS or sound == "off" or not (PREVIEWS / f"{sound}.mp3").is_file():
        raise ApiError(404, "no_sample", "There is no sample for this sound.")
    return FileResponse(PREVIEWS / f"{sound}.mp3", media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})
