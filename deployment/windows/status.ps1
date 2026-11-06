# Report the state of the local NexBot test stack.
$ErrorActionPreference = 'Continue'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repo

docker compose -p nexbot --env-file .env.local -f compose.yml -f compose.local.yml ps
Write-Host ''

function Probe($name, $url) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $url -ErrorAction Stop
        Write-Host ("{0,-10} HTTP {1}" -f $name, $r.StatusCode) -ForegroundColor Green
    } catch {
        $code = 'unreachable'
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        Write-Host ("{0,-10} {1}" -f $name, $code) -ForegroundColor Yellow
    }
}

Probe 'health' 'http://127.0.0.1:8080/api/health'
Probe 'ready'  'http://127.0.0.1:8080/api/ready'
Write-Host ''
Write-Host 'Open: http://localhost:8080' -ForegroundColor Cyan
