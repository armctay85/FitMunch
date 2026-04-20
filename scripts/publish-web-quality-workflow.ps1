# Pushes .github/workflows/web-quality.yml via GitHub API (uses `gh` token).
# Requires: `gh auth refresh -h github.com -s workflow` once so the token includes the workflow scope.
$ErrorActionPreference = "Stop"
$repo = "armctay85/FitMunch"
$rel = ".github/workflows/web-quality.yml"
$path = Join-Path (Join-Path $PSScriptRoot "..") $rel
$raw = Get-Content -Raw -LiteralPath $path
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($raw))
$payload = @{ message = "ci: add web-quality workflow (jest on ubuntu)"; content = $b64 } | ConvertTo-Json -Compress
$payload | gh api -X PUT "repos/$repo/contents/$rel" --input -
if ($LASTEXITCODE -ne 0) {
  Write-Host @"

FAILED (GitHub often returns 404 if the token lacks the 'workflow' scope).

One-time fix — run in PowerShell, complete the browser/device prompt, then re-run this script:
  gh auth refresh -h github.com -s workflow

Git is configured to use the same GitHub token when you run: gh auth setup-git
"@
  exit 1
}
Write-Host "OK: workflow published to $repo"
