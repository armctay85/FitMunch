#!/usr/bin/env bash
# Open or comment on the catalogue failure issue. Does not merge anything.
set -euo pipefail

title="Catalogue refresh failed"
if [[ -f catalogue-refresh-failure.txt ]]; then
  body="$(cat catalogue-refresh-failure.txt)"
else
  body="Catalogue refresh failed before it could record a source reason. See the workflow log and docs/catalogue-source.md."
fi

existing="$(gh issue list --state open --search "in:title Catalogue refresh failed" --json number --jq '.[0].number')"
if [[ -n "$existing" && "$existing" != "null" ]]; then
  gh issue comment "$existing" --body "$body"
else
  gh issue create --title "$title" --body "$body"
fi
