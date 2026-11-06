# Keeps the local NexBot stack healthy without administrator rights.
#
# Polls /api/ready and, after a run of consecutive failures, restarts the stack
# once. A single restart is attempted per outage so a genuinely broken
# configuration does not turn into a restart loop; the failure count resets as
# soon as the app answers again.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File deployment\windows\watchdog.ps1
#   powershell ... -File watchdog.ps1 -IntervalSeconds 30 -FailuresBeforeRestart 3
#
# Install it to run at logon together with the app (see install-autostart.ps1).
param(
    [int]$IntervalSeconds = 60,
    [int]$FailuresBeforeRestart = 3,
    [string]$Url = 'http://127.0.0.1:8080/api/ready'
)

$ErrorActionPreference = 'Continue'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir 'watchdog.log'

function Write-Log($message) {
    $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    Add-Content -Path $log -Value $line
    Write-Host $line
}

function Test-Ready {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 $Url -ErrorAction Stop
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

Write-Log "watchdog started (interval ${IntervalSeconds}s, threshold $FailuresBeforeRestart)"

$failures = 0
$restartedForThisOutage = $false

while ($true) {
    Start-Sleep -Seconds $IntervalSeconds

    if (Test-Ready) {
        if ($failures -gt 0) { Write-Log "recovered after $failures failed check(s)" }
        $failures = 0
        $restartedForThisOutage = $false
        continue
    }

    $failures++
    Write-Log "readiness check failed ($failures/$FailuresBeforeRestart)"

    if ($failures -ge $FailuresBeforeRestart -and -not $restartedForThisOutage) {
        Write-Log 'restarting the stack'
        Push-Location $repo
        try {
            # start.ps1 writes progress to stderr, which PowerShell would treat
            # as a terminating error; capture it as log text instead.
            $output = & (Join-Path $PSScriptRoot 'start.ps1') 2>&1 | Out-String
            Add-Content -Path $log -Value $output
            Write-Log "restart finished (exit $LASTEXITCODE)"
        } catch {
            Write-Log "restart threw: $($_.Exception.Message)"
        } finally {
            Pop-Location
        }
        # One restart per outage: wait for the configured number of checks again
        # before trying once more, so a bad config cannot spin.
        $restartedForThisOutage = $true
        $failures = 0
    }
}
