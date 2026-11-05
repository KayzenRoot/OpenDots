# Build OpenDots-Setup.exe: a self-extracting installer for end customers.
#
#   powershell -ExecutionPolicy Bypass -File deployment\windows\build-installer.ps1
#
# Output: dist\OpenDots-Setup.exe
#
# The payload is copied from an explicit allowlist, so no .env.local, no
# credentials and no node_modules/dist artefacts can end up inside the installer.
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dist = Join-Path $repo 'dist'
$stage = Join-Path $dist 'payload'
$zip = Join-Path $dist 'payload.zip'
$out = Join-Path $dist 'OpenDots-Setup.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw '.NET Framework 4.x (csc.exe) is required to build the installer.' }

Write-Host 'Cleaning dist...' -ForegroundColor Cyan
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
if (Test-Path $out) { Remove-Item $out -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# Explicit allowlist: nothing else is shipped.
$files = @(
    'compose.yml', 'compose.local.yml', '.env.example',
    'Dockerfile', '.dockerignore',
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.server.json',
    'vite.config.ts', 'index.html', 'eslint.config.js', 'knip.json',
    'README.md', 'LICENSE'
)
$dirs = @('src', 'public', 'deployment')

Write-Host 'Staging payload...' -ForegroundColor Cyan
foreach ($f in $files) {
    $src = Join-Path $repo $f
    if (-not (Test-Path $src)) { Write-Warning "missing $f (skipped)"; continue }
    Copy-Item $src (Join-Path $stage $f) -Force
}
foreach ($d in $dirs) {
    $src = Join-Path $repo $d
    if (-not (Test-Path $src)) { continue }
    Copy-Item $src (Join-Path $stage $d) -Recurse -Force -Exclude @('node_modules', 'dist', '.env.local', 'OpenDots-Setup.exe')
}

# Ship the compiled desktop launcher if it has been built.
$launcher = Join-Path $repo 'deployment\windows\OpenDots.exe'
if (-not (Test-Path $launcher)) {
    Write-Host 'Building desktop launcher...' -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot 'build-launcher.cmd') | Out-Null
}
if (Test-Path $launcher) { Copy-Item $launcher (Join-Path $stage 'deployment\windows\OpenDots.exe') -Force }

# Refuse to ship anything secret-looking.
# Match credential SHAPES, not the pattern names, so this script does not flag
# itself: a real Slack token starts with digits after `xoxb-`, and real API keys
# continue with alphanumerics after their prefix.
$leaks = Get-ChildItem $stage -Recurse -File |
    Select-String -Pattern 'xoxb-\d[A-Za-z0-9-]{20,}|oc_sk_[A-Za-z0-9]{16,}|thk_live_[A-Za-z0-9]{16,}|OWNER_TOKEN=[A-Za-z0-9_-]{24,}' -List
if ($leaks) {
    throw "Refusing to build: payload contains what looks like a credential -> $($leaks.Path -join ', ')"
}

Write-Host 'Compiling setup stub...' -ForegroundColor Cyan
$stub = Join-Path $dist 'Setup.exe'
& $csc /nologo /target:winexe /out:$stub /r:System.Windows.Forms.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll (Join-Path $PSScriptRoot 'Setup.cs')
if ($LASTEXITCODE -ne 0) { throw 'csc failed' }

Write-Host 'Compressing payload...' -ForegroundColor Cyan
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)

Write-Host 'Assembling self-extracting exe...' -ForegroundColor Cyan
$stubBytes = [IO.File]::ReadAllBytes($stub)
$zipBytes = [IO.File]::ReadAllBytes($zip)
$fs = [IO.File]::Create($out)
try {
    $fs.Write($stubBytes, 0, $stubBytes.Length)
    $fs.Write($zipBytes, 0, $zipBytes.Length)
    # Trailing int64 = payload length, so the stub can locate the zip exactly.
    $lenBytes = [BitConverter]::GetBytes([int64]$zipBytes.Length)
    $fs.Write($lenBytes, 0, $lenBytes.Length)
} finally { $fs.Close() }
Remove-Item $stub -Force

$mb = [Math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host ''
Write-Host "Built $out ($mb MB)" -ForegroundColor Green
Write-Host 'Ship that single file. It installs to %LOCALAPPDATA%\OpenDots and needs only Docker.' -ForegroundColor DarkGray
