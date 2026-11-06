# Stop the local NexBot test stack. Volumes (conversations and SQLite) are kept.
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo

docker compose -p nexbot --env-file .env.local -f compose.yml -f compose.local.yml stop
Write-Host 'Stopped. Data is preserved in the nexbot volumes.' -ForegroundColor Yellow
