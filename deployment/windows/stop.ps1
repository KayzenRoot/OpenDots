# Stop the local OpenDots test stack. Volumes (conversations and SQLite) are kept.
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo

docker compose -p opendots --env-file .env.local -f compose.yml -f compose.local.yml stop
Write-Host 'Stopped. Data is preserved in the opendots volumes.' -ForegroundColor Yellow
