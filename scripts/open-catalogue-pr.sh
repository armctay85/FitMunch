#!/usr/bin/env bash
# Open or update the catalogue pull request. Does not merge.
set -euo pipefail

if [[ ! -f data/catalogue/current.json || ! -f data/catalogue/SUMMARY.md ]]; then
  echo "No catalogue files to open a pull request for." >&2
  exit 1
fi

valid_from="$(node -p "require('./data/catalogue/current.json').validFrom")"
valid_to="$(node -p "require('./data/catalogue/current.json').validTo")"
branch="catalogue/${valid_from}"
title="Catalogue ${valid_from} to ${valid_to}"

git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"
git checkout -B "$branch"
git add data/catalogue
if git diff --cached --quiet; then
  echo "Catalogue files are unchanged."
else
  git commit -m "$title"
fi
if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  git push --force-with-lease -u origin "$branch"
else
  git push -u origin "$branch"
fi

existing="$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number')"
if [[ -n "$existing" && "$existing" != "null" ]]; then
  gh pr edit "$existing" --title "$title" --body-file data/catalogue/SUMMARY.md
else
  gh pr create --base main --head "$branch" --title "$title" --body-file data/catalogue/SUMMARY.md
fi
