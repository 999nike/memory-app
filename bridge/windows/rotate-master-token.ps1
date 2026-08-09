[CmdletBinding()]
param(
    [string]$TaskName = 'Memory Space Bridge'
)

$ErrorActionPreference = 'Stop'

$bridgeDir = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $bridgeDir '.state'
$configPath = Join-Path $stateDir 'windows-runtime.json'
$credentialPath = Join-Path $stateDir 'windows-token.clixml'
$credentialTempPath = "$credentialPath.rotate.tmp"
$rotationHelper = Join-Path $bridgeDir 'rotate-master-token.mjs'

if (!(Test-Path $configPath) -or !(Test-Path $credentialPath)) {
    throw 'Memory Bridge autostart is not configured. Run bridge\windows\install-autostart.cmd first.'
}
if (!(Test-Path $rotationHelper)) {
    throw 'Credential rotation helper is missing. Run git pull before rotating the bridge credential.'
}

$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
$credential = Import-Clixml -Path $credentialPath
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
try {
    $oldToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$bytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
} finally {
    $rng.Dispose()
}
$newToken = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$secureNewToken = ConvertTo-SecureString $newToken -AsPlainText -Force
$newCredential = New-Object System.Management.Automation.PSCredential('memory-bridge', $secureNewToken)
$newCredential | Export-Clixml -Path $credentialTempPath

$nodePath = [string]$config.nodePath
if ([string]::IsNullOrWhiteSpace($nodePath) -or !(Test-Path $nodePath)) {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
}
$port = if ($config.port) { [int]$config.port } else { 8787 }
$connectionStateFile = Join-Path $stateDir 'customer-connections.enc.json'
$oauthStateFile = if ($config.oauthStateFile) { [string]$config.oauthStateFile } else { Join-Path $stateDir 'oauth-state.enc.json' }

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

$previousOld = $env:MEMORY_BRIDGE_OLD_TOKEN
$previousNew = $env:MEMORY_BRIDGE_NEW_TOKEN
$previousConnectionState = $env:MEMORY_BRIDGE_CONNECTION_STATE_FILE
$previousOauthState = $env:MEMORY_BRIDGE_OAUTH_STATE_FILE

try {
    $env:MEMORY_BRIDGE_OLD_TOKEN = $oldToken
    $env:MEMORY_BRIDGE_NEW_TOKEN = $newToken
    $env:MEMORY_BRIDGE_CONNECTION_STATE_FILE = $connectionStateFile
    $env:MEMORY_BRIDGE_OAUTH_STATE_FILE = $oauthStateFile

    $rotationOutput = & $nodePath $rotationHelper
    if ($LASTEXITCODE -ne 0) {
        throw 'Bridge credential state rotation failed. The stored Windows credential was not changed.'
    }

    Move-Item -Force -Path $credentialTempPath -Destination $credentialPath
} catch {
    Remove-Item -Force -Path $credentialTempPath -ErrorAction SilentlyContinue
    if ($task) { Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    throw
} finally {
    if ($null -eq $previousOld) { Remove-Item Env:MEMORY_BRIDGE_OLD_TOKEN -ErrorAction SilentlyContinue } else { $env:MEMORY_BRIDGE_OLD_TOKEN = $previousOld }
    if ($null -eq $previousNew) { Remove-Item Env:MEMORY_BRIDGE_NEW_TOKEN -ErrorAction SilentlyContinue } else { $env:MEMORY_BRIDGE_NEW_TOKEN = $previousNew }
    if ($null -eq $previousConnectionState) { Remove-Item Env:MEMORY_BRIDGE_CONNECTION_STATE_FILE -ErrorAction SilentlyContinue } else { $env:MEMORY_BRIDGE_CONNECTION_STATE_FILE = $previousConnectionState }
    if ($null -eq $previousOauthState) { Remove-Item Env:MEMORY_BRIDGE_OAUTH_STATE_FILE -ErrorAction SilentlyContinue } else { $env:MEMORY_BRIDGE_OAUTH_STATE_FILE = $previousOauthState }
}

Start-ScheduledTask -TaskName $TaskName

$healthy = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $headers = @{ Authorization = "Bearer $newToken" }
        $info = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/v1/info" -Headers $headers -TimeoutSec 2
        if ($info.protocol -eq 'memory-space-bridge') {
            $healthy = $true
            break
        }
    } catch {}
}

if (!$healthy) {
    throw 'The credential was rotated, but the Memory Bridge did not become healthy within 20 seconds. Check bridge\.state\windows-autostart.log.'
}

$publicUrl = if ($config.publicUrl) { [string]$config.publicUrl } else { 'https://bridge.w-i-z-z-lab-studios.com' }
$bridgeName = if ($config.name) { [string]$config.name } else { 'Memory Bridge' }
$ownerPayload = [ordered]@{
    version = 1
    name = $bridgeName
    baseUrl = $publicUrl.TrimEnd('/')
    token = $newToken
} | ConvertTo-Json -Compress
$ownerBytes = [System.Text.Encoding]::UTF8.GetBytes($ownerPayload)
$ownerCode = 'MSB1.' + [Convert]::ToBase64String($ownerBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$copied = $false
try {
    Set-Clipboard -Value $ownerCode
    $copied = $true
} catch {}

Write-Host 'Memory Bridge master credential rotated successfully.'
Write-Host 'Private MSB2 customer credentials were preserved.'
Write-Host 'Owner OAuth recovery state was re-encrypted when available.'
if ($rotationOutput) { Write-Host "Rotation state: $rotationOutput" }
if ($copied) {
    Write-Host 'A new owner MSB1 access code is now on the clipboard. Use it only to update the owner bridge in Memory Space.'
} else {
    Write-Host 'The new owner access code could not be copied to the clipboard automatically. Do not expose the raw master token.'
}
