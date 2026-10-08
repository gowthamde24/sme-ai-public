"""deploy/Dockerfile.api must carry lane C's pure packages and put them on PYTHONPATH.

Source: docs/pre-pilot-checklist.md, the T012 (deploy) row. Without them the image cannot import
`quote_engine`, `quote_text`, `requirement_mapper` or `followup_cadence`, and quotes and follow-ups
fail closed with 503. The API finds the packages only in a checkout; in an image it relies on
PYTHONPATH. CI does not build the image, so this test reads the file. (Proved once by a local build
and a smoke import through the four ports, 2026-10-08.)"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DOCKERFILE = (ROOT / "deploy" / "Dockerfile.api").read_text().splitlines()


def _lines(prefix: str) -> list[str]:
    return [line.strip() for line in DOCKERFILE if line.strip().startswith(prefix)]


def test_the_two_package_trees_exist_where_the_copy_lines_point() -> None:
    assert (ROOT / "packages" / "quote-engine" / "src").is_dir()
    assert (ROOT / "packages" / "pure").is_dir()


def test_the_image_copies_both_package_trees() -> None:
    copies = _lines("COPY ")
    assert "COPY packages/quote-engine/src ./packages/quote-engine/src" in copies
    assert "COPY packages/pure ./packages/pure" in copies


def test_the_copies_come_before_the_install_step() -> None:
    text = "\n".join(DOCKERFILE)
    assert text.index("COPY packages/pure") < text.index("RUN pip install")


def test_pythonpath_names_both_trees_at_their_image_paths() -> None:
    paths = [line for line in _lines("ENV ") if line.startswith("ENV PYTHONPATH=")]
    assert len(paths) == 1
    entries = paths[0].removeprefix("ENV PYTHONPATH=").split(":")
    assert "/srv/packages/quote-engine/src" in entries
    assert "/srv/packages/pure" in entries


def test_the_image_does_not_run_as_root_after_the_copies() -> None:
    assert "USER 10001" in _lines("USER ")
