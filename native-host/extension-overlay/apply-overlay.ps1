# Installs the Five9 volume DLC into a local Student Retention Kit
# extension folder. Two changes:
#
#   1. Replaces src/background/background-volume.js (the public stub) with
#      the real handler that talks to the com.srk.five9volume native host.
#   2. Merges manifest.patch.json into the extension's manifest.json,
#      adding the "nativeMessaging" permission (idempotent).
#
# Usage:
#   .\apply-overlay.ps1 -ExtensionPath C:\path\to\Student-Retention-Kit-Chrome-Extension
#
# After running: in chrome://extensions, click Reload on the extension. The
# matching native host must also be installed; see ..\install.ps1.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ExtensionPath)) {
    throw "Extension folder not found: $ExtensionPath"
}

$manifestPath  = Join-Path $ExtensionPath 'manifest.json'
$bgVolumeDest  = Join-Path $ExtensionPath 'src\background\background-volume.js'
if (-not (Test-Path $manifestPath)) {
    throw "manifest.json not found at: $manifestPath (is this the right folder?)"
}
if (-not (Test-Path (Split-Path -Parent $bgVolumeDest))) {
    throw "src\background folder not found in extension. Folder layout has changed?"
}

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$bgVolumeSrc = Join-Path $ScriptDir 'background-volume.js'
$patchPath   = Join-Path $ScriptDir 'manifest.patch.json'

# --- 1. Drop the real volume handler over the stub ---
Copy-Item -Force -Path $bgVolumeSrc -Destination $bgVolumeDest
Write-Host "Overlaid: $bgVolumeDest"

# --- 2. Merge manifest patch (add nativeMessaging permission, idempotent) ---
# Read both files as ordered hashtables so we don't reorder unrelated keys.
$manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
$patch    = Get-Content -Raw -Path $patchPath    | ConvertFrom-Json

$existing = @($manifest.permissions)
$added = @()
foreach ($perm in $patch.permissions) {
    if ($existing -notcontains $perm) {
        $existing += $perm
        $added += $perm
    }
}
$manifest.permissions = $existing

# Write back with 2-space indent to match the source style.
$json = $manifest | ConvertTo-Json -Depth 32
Set-Content -Path $manifestPath -Value $json -Encoding UTF8

if ($added.Count -gt 0) {
    Write-Host "Added permission(s) to manifest.json: $($added -join ', ')"
} else {
    Write-Host "manifest.json already has all required permissions (no change)"
}

Write-Host ""
Write-Host "Overlay applied." -ForegroundColor Green
Write-Host "Next: chrome://extensions -> Reload the extension."
Write-Host "      Then make sure the native host is installed (..\install.ps1)."
