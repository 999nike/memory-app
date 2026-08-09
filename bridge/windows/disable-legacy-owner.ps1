[CmdletBinding()]
param(
    [string]$TaskName = 'Memory Space Bridge'
)

$ErrorActionPreference = 'Stop'

$bridgeDir = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $bridgeDir '.state'
$configPath = Join-Path $stateDir 'windows-runtime.json'
$ownerCredentialPath = Join-Path $stateDir 'windows-token.clixml'
$adminCredentialPath = Join-Path $stateDir 'windows-admin-token.clixml'
$legacyOwnerDisabledFlag = Join-Path $stateDir 'legacy-owner-disabled.flag'

if (!(Test-Path $configPath) -or !(Test-Path $adminCredentialPath)) {
    throw 'Memory Bridge owner/admin split is not configured. Run the administrator rotation first.'
}

$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
$port = if ($config.port) { [int]$config.port } else { 8787 }
$oauthStateFile = if ($config.oauthStateFile) { [string]$config.oauthStateFile } else { Join-Path $stateDir 'oauth-state.enc.json' }

New-Item -ItemType File -Force -Path $legacyOwnerDisabledFlag | Out-Null
Remove-Item -Force -Path $ownerCredentialPath -ErrorAction SilentlyContinue
Remove-Item -Force -Path $oauthStateFile -ErrorAction SilentlyContinue

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

Start-ScheduledTask -TaskName $TaskName

Write-Host 'Legacy owner credential retired.'
Write-Host 'The stored owner MSB1 credential and legacy root OAuth recovery state were removed.'
Write-Host 'The administrator credential, private MSB2 customer credentials, and tenant OAuth state were left untouched.'
Write-Host 'The supervisor will now use a non-persisted random owner token only for dormant legacy-root compatibility.'
