"""The only text that ever flows from the runtime back into a model's context as TRUSTED: fixed
phrases. A tool's outcome is reported to the model by choosing one of these, never by quoting
a database message, a model reply or an exception."""

NOTE_RECORDED = "The previous tool call was recorded."
NOTE_REFUSED = (
    "A previous tool call was refused. Only the listed tools with valid arguments are accepted."
)
NOTE_REPAIR = (
    "Your previous reply did not match the required format. "
    "Reply again using only the listed tools, or the final result format."
)
NOTE_FETCH_FAILED = (
    "The page could not be fetched (it is missing, blocked by the site's robots.txt, or not "
    "readable). Try another path of the same website, or finish."
)
NOTE_EVIDENCE_REFUSED = (
    "That quote was refused: it must be copied exactly from a page you were shown, and contain "
    "no contact details."
)
FIXED_NOTES = frozenset(
    {NOTE_RECORDED, NOTE_REFUSED, NOTE_REPAIR, NOTE_FETCH_FAILED, NOTE_EVIDENCE_REFUSED}
)
