#!/usr/bin/env python3
"""Dependency-free structural and JavaScript syntax checks for the static game."""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "index.html"


class PageInspector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.references = []
        self.inline_scripts = []
        self.script_attrs = []
        self.style_count = 0
        self._script = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        for attr in ("href", "src"):
            if attr in attrs:
                self.references.append((tag, attr, attrs[attr]))
        if tag == "style":
            self.style_count += 1
        if tag == "script":
            self.script_attrs.append(attrs)
            self._script = []

    def handle_data(self, data):
        if self._script is not None:
            self._script.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._script is not None:
            self.inline_scripts.append("".join(self._script))
            self._script = None


def fail(message):
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def main():
    if not PAGE.is_file():
        fail("index.html is missing")
    html = PAGE.read_text(encoding="utf-8")
    if not re.search(r"<!doctype\s+html\s*>", html, re.IGNORECASE):
        fail("index.html is missing its HTML5 doctype")

    page = PageInspector()
    page.feed(html)
    page.close()

    duplicates = [ident for ident, count in Counter(page.ids).items() if count > 1]
    if duplicates:
        fail("duplicate HTML id(s): " + ", ".join(sorted(duplicates)))
    if len(page.inline_scripts) != 1 or len(page.script_attrs) != 1:
        fail(f"expected one self-contained inline game script; found {len(page.inline_scripts)}")
    if page.script_attrs[0].get("src"):
        fail("the game script must remain self-contained (unexpected script src)")
    if page.style_count != 1:
        fail(f"expected one embedded stylesheet; found {page.style_count}")

    ids = set(page.ids)
    for tag, attr, ref in page.references:
        if not ref or ref.startswith(("data:", "javascript:", "mailto:", "tel:")):
            continue
        parsed = urlsplit(ref)
        if parsed.scheme or parsed.netloc:
            # The game is intentionally fully self-contained; avoid accidental
            # network dependencies or third-party tracking.
            fail(f"unexpected external {attr} on <{tag}>: {ref}")
        if ref.startswith("#"):
            anchor = parsed.fragment
            if anchor and anchor not in ids:
                fail(f"broken in-page link: #{anchor}")
            continue
        if parsed.path:
            target = (ROOT / parsed.path.lstrip("/")).resolve()
            if ROOT.resolve() not in target.parents and target != ROOT.resolve():
                fail(f"local {attr} escapes repository: {ref}")
            if not target.is_file():
                fail(f"missing local file referenced by {attr}: {ref}")

    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8") as script:
        script.write(page.inline_scripts[0])
        script.flush()
        result = subprocess.run(["node", "--check", script.name], text=True, capture_output=True)
    if result.returncode:
        fail("JavaScript syntax check failed:\n" + result.stderr.strip())

    # Catch accidental unclosed/extra CSS blocks while ignoring comments and
    # quoted strings that may contain brace characters.
    css = re.search(r"<style\b[^>]*>(.*?)</style\s*>", html, re.IGNORECASE | re.DOTALL)
    if not css:
        fail("embedded stylesheet could not be read")
    stripped = re.sub(r"/\*.*?\*/", "", css.group(1), flags=re.DOTALL)
    stripped = re.sub(r"(['\"])(?:\\.|(?!\1).)*\1", "''", stripped, flags=re.DOTALL)
    depth = 0
    for char in stripped:
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth < 0:
                fail("stylesheet has an unexpected closing brace")
    if depth:
        fail("stylesheet has unclosed brace(s)")

    print(f"PASS: index.html structure ({len(ids)} unique IDs, no external dependencies)")
    print("PASS: embedded JavaScript syntax")
    print("PASS: embedded stylesheet brace balance")


if __name__ == "__main__":
    main()
