"""Cut the model's reply into pieces the voice can start on (job natural-voice): the FIRST piece goes to the voice as soon as it is a clause (a comma, a stop, or 100 characters), so the caller hears the
start of the answer while the model is still writing the rest. Later pieces go at sentence ends, never longer than 150 characters. Never waits for the whole reply.

Works for the scripts of our languages: the sentence marks are `. ! ? | ... ;` and the danda; a comma ends the FIRST piece only (a comma in the middle of a long reply is a breath, not a stop)."""

# ruff: noqa: E501

from __future__ import annotations

FIRST_MIN = 6       # a first piece shorter than this ("Hmm,") is too little to speak (Telugu counts code points: "హా అండీ," is 8)
FIRST_SOFT_MAX = 100  # no clause mark yet: cut at the last space before this
HARD_MAX = 150
STOPS = "!?।…;"      # always end a piece (a '.' too, unless it sits inside a number)
CLAUSE = ",:"        # end the FIRST piece only


class ClauseBuffer:
    def __init__(self) -> None:
        self._buf = ""
        self._sent = 0  # pieces already handed out

    def feed(self, delta: str) -> list[str]:
        self._buf += delta
        out: list[str] = []
        while (piece := self._take()) is not None:
            out.append(piece)
        return out

    def flush(self) -> list[str]:
        rest = self._buf.strip()
        self._buf = ""
        if rest:
            self._sent += 1
            return [rest]
        return []

    def _take(self) -> str | None:
        buf = self._buf
        first = self._sent == 0
        for i, ch in enumerate(buf):
            end = False
            if ch in STOPS:
                end = True
            elif ch == ".":
                nxt = buf[i + 1] if i + 1 < len(buf) else ""
                prev = buf[i - 1] if i else ""
                if nxt == "" and prev.isdigit():
                    return self._cut_long(buf, first)  # '2.' might be '2.5': wait for the next piece of text
                end = not (prev.isdigit() and nxt.isdigit())
            elif first and ch in CLAUSE:
                end = True
            if end and (i + 1 >= (FIRST_MIN if first else 1) or ch in "!?।"):
                return self._emit(i + 1)
            if i + 1 >= HARD_MAX:
                break
        return self._cut_long(buf, first)

    def _cut_long(self, buf: str, first: bool) -> str | None:
        limit = FIRST_SOFT_MAX if first else HARD_MAX
        if len(buf) < limit:
            return None
        cut = buf.rfind(" ", 0, limit)
        return self._emit(cut + 1 if cut > 0 else limit)

    def _emit(self, n: int) -> str | None:
        piece, self._buf = self._buf[:n].strip(), self._buf[n:].lstrip()
        if not piece:
            return None
        self._sent += 1
        return piece
