# Installs the Five9 Volume Host as a Chrome native messaging host (per-user).
#
# Prerequisites:
#   - Five9VolumeHost.exe must already be built (see README → "Build").
#     The script looks for it in:
#       1) .\bin\Release\net8.0-windows\win-x64\publish\Five9VolumeHost.exe
#       2) .\Five9VolumeHost.exe   (if you copied the published exe alongside this script)
#
# What this does:
#   1. Copies the exe and manifest to %LocalAppData%\StudentRetentionKit\
#   2. Rewrites the manifest to point at the installed exe path
#   3. Writes the per-user registry key Chrome reads at startup:
#        HKCU\Software\Google\Chrome\NativeMessagingHosts\com.srk.five9volume
#
# No admin rights required. To uninstall, run uninstall.ps1.

$ErrorActionPreference = 'Stop'
$ProgressPreference   = 'SilentlyContinue'

$HostName    = 'com.srk.five9volume'
$InstallDir  = Join-Path $env:LocalAppData 'StudentRetentionKit'
$ExeName     = 'Five9VolumeHost.exe'
$ExeDest     = Join-Path $InstallDir $ExeName
$ManifestDest = Join-Path $InstallDir "$HostName.json"
$RegPath     = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"

# Locate the script's directory so we resolve paths predictably no matter
# where the user runs it from.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# --- 1. Find the built exe ---
# Candidate paths, in priority order:
#   1. A fresh build output (developer who just ran `dotnet publish`).
#   2. A `prebuilt\` folder committed to the repo so a fresh clone can
#      install without needing the .NET SDK and a build toolchain.
#   3. Loose alongside install.ps1 (manual drop-in).
$candidatePaths = @(
    (Join-Path $ScriptDir 'bin\Release\net8.0-windows\win-x64\publish\Five9VolumeHost.exe'),
    (Join-Path $ScriptDir 'prebuilt\Five9VolumeHost.exe'),
    (Join-Path $ScriptDir 'Five9VolumeHost.exe')
)
$ExeSource = $null
foreach ($p in $candidatePaths) {
    if (Test-Path $p) { $ExeSource = $p; break }
}
if (-not $ExeSource) {
    Write-Host "ERROR: Could not find Five9VolumeHost.exe." -ForegroundColor Red
    Write-Host "       Build it first with:  dotnet publish -c Release -r win-x64" -ForegroundColor Red
    Write-Host "       Or copy the published files into a 'prebuilt' folder next to install.ps1." -ForegroundColor Red
    exit 1
}

$ManifestTemplate = Join-Path $ScriptDir 'manifest.template.json'
if (-not (Test-Path $ManifestTemplate)) {
    Write-Host "ERROR: manifest.template.json not found next to install.ps1" -ForegroundColor Red
    exit 1
}

# --- 2. Copy files into a stable per-user location ---
# Copy the entire directory containing the exe, not just the exe itself.
# An AOT build produces a single self-contained exe (one file), but a
# regular self-contained build produces an exe bootstrapper plus many
# supporting DLLs (Five9VolumeHost.dll, the .NET runtime, etc.). Copying
# the whole folder handles both cases and is a no-op for the AOT case.
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$ExeSourceDir = Split-Path -Parent $ExeSource
Copy-Item -Force -Recurse -Path (Join-Path $ExeSourceDir '*') -Destination $InstallDir
Write-Host "Copied: $InstallDir"

# Defensive: strip the "Mark of the Web" zone identifier if any. Files built
# locally won't have one, but if you cloned via a zip download or the binary
# was shared from elsewhere, MOTW could be attached and SmartScreen would
# warn on first launch. Unblock-File removes it.
try {
    Unblock-File -Path $ExeDest -ErrorAction Stop
    Write-Host "Unblocked: $ExeDest (MOTW cleared)"
} catch {
    # Unblock-File errors out only if the file doesn't exist. We just copied it
    # so this should never fail in practice. Swallow for resilience.
}

# --- 3. Generate the manifest with the absolute exe path ---
$json = (Get-Content -Raw -Path $ManifestTemplate) -replace '__INSTALL_PATH__', ($ExeDest -replace '\\', '\\\\')
Set-Content -Path $ManifestDest -Value $json -Encoding UTF8
Write-Host "Wrote manifest: $ManifestDest"

# --- 4. Register with Chrome ---
if (-not (Test-Path $RegPath)) {
    New-Item -Path $RegPath -Force | Out-Null
}
Set-ItemProperty -Path $RegPath -Name '(Default)' -Value $ManifestDest
Write-Host "Registered: $RegPath -> $ManifestDest"

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "Reload your Chrome extension and test a call."
Write-Host ""
Write-Host "To verify the host responds, run this in PowerShell:" -ForegroundColor Cyan
Write-Host '  & "' + $ExeDest + '"  # should hang waiting for stdin — Ctrl+C to exit'
