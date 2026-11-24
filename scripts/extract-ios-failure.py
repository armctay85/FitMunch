#!/usr/bin/env python3
"""Export iOS UI failure evidence from xcresult bundles and xcodebuild logs.

Writes screenshot PNG, view hierarchy, app stdout, and a step summary.
Skips DerivedData. Keeps the output under 20 MB.
"""

from pathlib import Path
import argparse
import os
import shutil
import subprocess

MAX_BYTES = 19 * 1024 * 1024
TEXT_SUFFIXES = {".txt", ".log", ".json", ".xml", ".md", ".plist"}


def run(cmd):
    return subprocess.run(cmd, check=False, capture_output=True, text=True)


def skip_derived(path: Path) -> bool:
    return "DerivedData" in path.parts


def find_bundles(root: Path):
    if not root.exists():
        return []
    found = []
    for path in root.rglob("*.xcresult"):
        if skip_derived(path):
            continue
        if path.is_dir():
            found.append(path)
    return found


def find_logs(root: Path):
    if not root.exists():
        return []
    logs = []
    for path in root.rglob("*"):
        if not path.is_file() or skip_derived(path):
            continue
        if path.suffix.lower() in {".log", ".txt"}:
            logs.append(path)
    return logs


def export_bundle(bundle: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    exported = dest / "attachments"
    exported.mkdir(parents=True, exist_ok=True)
    commands = [
        ["xcrun", "xcresulttool", "export", "attachments", "--path", str(bundle), "--output-path", str(exported)],
        ["xcrun", "xcresulttool", "export", "--type", "attachments", "--path", str(bundle), "--output-path", str(exported)],
    ]
    for cmd in commands:
        result = run(cmd)
        if result.returncode == 0:
            break
    summary = run(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(bundle)])
    tests = run(["xcrun", "xcresulttool", "get", "test-results", "tests", "--path", str(bundle)])
    if summary.stdout:
        (dest / "summary.txt").write_text(summary.stdout)
    if tests.stdout:
        (dest / "tests.txt").write_text(tests.stdout)
    if summary.stderr or tests.stderr:
        notes = (summary.stderr or "") + "\n" + (tests.stderr or "")
        (dest / "xcresulttool-stderr.txt").write_text(notes[-20000:])


def first_file(root: Path, suffixes):
    matches = []
    if not root.exists():
        return None
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in suffixes and not skip_derived(path):
            matches.append(path)
    matches.sort(key=lambda item: item.stat().st_size, reverse=True)
    return matches[0] if matches else None


def hierarchy_text(root: Path) -> str:
    texts = []
    if not root.exists():
        return ""
    for path in root.rglob("*"):
        if not path.is_file() or skip_derived(path):
            continue
        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".zip", ".car", ".dylib"}:
            continue
        if path.stat().st_size > 2_000_000:
            continue
        try:
            sample = path.read_text(errors="ignore")
        except OSError:
            continue
        if "identifier" in sample.lower() or "Button" in sample or "Application" in sample:
            texts.append(sample)
    if not texts:
        return ""
    texts.sort(key=len, reverse=True)
    return texts[0]


def assertion_lines(text: str):
    lines = []
    for line in text.splitlines():
        if "XCTAssert" in line or " error:" in line or line.strip().startswith("error:"):
            lines.append(line.strip())
    return lines[:40]


def excerpt_around(text: str, needle: str, radius: int = 40) -> str:
    rows = text.splitlines()
    if not rows:
        return ""
    index = 0
    if needle:
        for i, row in enumerate(rows):
            if needle in row:
                index = i
                break
    start = max(0, index - radius // 2)
    end = min(len(rows), start + radius)
    return "\n".join(rows[start:end])


def cap_tree(root: Path) -> None:
    files = [path for path in root.rglob("*") if path.is_file()]
    total = sum(path.stat().st_size for path in files)
    if total <= MAX_BYTES:
        return
    logs = sorted(
        (path for path in files if path.suffix.lower() in {".log", ".txt", ".json"}),
        key=lambda item: item.stat().st_size,
        reverse=True,
    )
    for path in logs:
        if total <= MAX_BYTES:
            break
        data = path.read_bytes()
        if len(data) <= 200_000:
            continue
        path.write_bytes(data[:200_000] + b"\n...[truncated]\n")
        total = sum(item.stat().st_size for item in root.rglob("*") if item.is_file())


def write_summary(out: Path, assertions, tree: str) -> str:
    body = ["## iOS failure evidence", ""]
    body.append("### Failing assertions")
    body.append("")
    if assertions:
        body.extend(f"- {line}" for line in assertions[:20])
    else:
        body.append("- No assertion line was parsed. See app-stdout.log and hierarchy.txt.")
    body.append("")
    body.append("### Element tree")
    body.append("")
    body.append("```")
    body.append(excerpt_around(tree, "identifier") or "(no hierarchy exported)")
    body.append("```")
    body.append("")
    text = "\n".join(body)
    (out / "step-summary.md").write_text(text)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write(text)
            handle.write("\n")
    return text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="source", required=True)
    parser.add_argument("--out", dest="output", required=True)
    args = parser.parse_args()
    source = Path(args.source)
    output = Path(args.output)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for bundle in find_bundles(source):
        export_bundle(bundle, output / bundle.stem)
    logs = find_logs(source)
    stdout_parts = []
    for log in logs:
        try:
            stdout_parts.append(f"===== {log} =====\n" + log.read_text(errors="ignore")[-400_000:])
        except OSError:
            continue
    (output / "app-stdout.log").write_text("\n".join(stdout_parts) if stdout_parts else "(no xcodebuild log found)\n")
    png = first_file(output, {".png"})
    if png and png.resolve() != (output / "screenshot.png").resolve():
        shutil.copyfile(png, output / "screenshot.png")
    tree = hierarchy_text(output)
    (output / "hierarchy.txt").write_text(tree or "(no view hierarchy exported)\n")
    combined = "\n".join(stdout_parts) + "\n" + tree
    assertions = assertion_lines(combined)
    write_summary(output, assertions, tree)
    cap_tree(output)
    size = sum(path.stat().st_size for path in output.rglob("*") if path.is_file())
    print(f"failure_evidence_bytes={size}")
    print(f"failure_evidence_dir={output.resolve()}")


if __name__ == "__main__":
    main()
