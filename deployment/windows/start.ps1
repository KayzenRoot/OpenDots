# Start the local NexBot test stack (app + Postgres + proxy).
# Idempotent: running it again converges to the same state.
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo

if (-not (Test-Path '.env.local')) {
    throw "Missing $repo\.env.local. Copy .env.example and fill it in first."
}

# At logon Docker Desktop is often not up yet. Wait for it, and start it if it
# is installed but not running, so autostart is reliable rather than racy.
$null = docker info 2>$null
if ($LASTEXITCODE -ne 0) {
    $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dd) {
        Write-Host 'Docker is not running; starting Docker Desktop...' -ForegroundColor Yellow
        Start-Process $dd | Out-Null
    }
    $up = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 3
        $null = docker info 2>$null
        if ($LASTEXITCODE -eq 0) { $up = $true; break }
    }
    if (-not $up) { throw 'Docker did not become ready. Start Docker Desktop and retry.' }
}

Write-Host 'Starting NexBot...' -ForegroundColor Cyan
# A variable already exported in the environment wins over --env-file, so a stray
# OPENAI_* in the shell silently overrides .env.local. Clear them first.
foreach ($v in @('OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_API_BASE','OPENAI_MODEL','OPENAI_EXTRA_HEADERS')) {
    Remove-Item "Env:$v" -ErrorAction SilentlyContinue
}

docker compose -p nexbot --env-file .env.local -f compose.yml -f compose.local.yml up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed ($LASTEXITCODE)" }

Write-Host 'Waiting for readiness...' -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:8080/api/ready' -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) { throw 'App did not become ready within 120s. Check: docker compose -p nexbot logs app' }

docker compose -p nexbot ps
Write-Host ''
Write-Host 'NexBot is ready:  http://localhost:8080' -ForegroundColor Green
Write-Host 'Direct app port:    http://127.0.0.1:4310' -ForegroundColor DarkGray
