# Start the local OpenDots test stack (app + Postgres + proxy).
# Idempotent: running it again converges to the same state.
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo

if (-not (Test-Path '.env.local')) {
    throw "Missing $repo\.env.local. Copy .env.example and fill it in first."
}

Write-Host 'Starting OpenDots...' -ForegroundColor Cyan
docker compose -p opendots --env-file .env.local -f compose.yml -f compose.local.yml up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed ($LASTEXITCODE)" }

Write-Host 'Waiting for readiness...' -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:8080/api/ready' -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) { throw 'App did not become ready within 120s. Check: docker compose -p opendots logs app' }

docker compose -p opendots ps
Write-Host ''
Write-Host 'OpenDots is ready:  http://localhost:8080' -ForegroundColor Green
Write-Host 'Direct app port:    http://127.0.0.1:4310' -ForegroundColor DarkGray
