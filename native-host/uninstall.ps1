# Removes the Five9 Volume Host registration and installed files.
# No admin rights required.

$ErrorActionPreference = 'Continue'

$HostName    = 'com.srk.five9volume'
$InstallDir  = Join-Path $env:LocalAppData 'StudentRetentionKit'
$RegPath     = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"

# 1. Remove the Chrome registration so the extension can no longer launch the host.
if (Test-Path $RegPath) {
    Remove-Item -Path $RegPath -Force -Recurse
    Write-Host "Removed registry: $RegPath"
} else {
    Write-Host "Registry key not found (already uninstalled?)"
}

# 2. Remove the installed files. Leaves the parent dir alone in case the user
# stores other things there.
$ExeDest      = Join-Path $InstallDir 'Five9VolumeHost.exe'
$ManifestDest = Join-Path $InstallDir "$HostName.json"

foreach ($f in @($ExeDest, $ManifestDest)) {
    if (Test-Path $f) {
        Remove-Item -Path $f -Force
        Write-Host "Removed: $f"
    }
}

# Clean up the install dir if it's now empty.
if ((Test-Path $InstallDir) -and -not (Get-ChildItem -Path $InstallDir -Force)) {
    Remove-Item -Path $InstallDir -Force
    Write-Host "Removed empty dir: $InstallDir"
}

Write-Host ""
Write-Host "Uninstall complete." -ForegroundColor Green
