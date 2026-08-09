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
$adminCredentialTempPath = "$adminCredentialPath.rotate.tmp"
$rotationHelper = Join-Path $bridgeDir 'rotate-master-token.mjs'

function Read-ProtectedToken([string]$Path) {
    $credential = Import-Clixml -Path $Path
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if (!(Test-Path $configPath) -or !(Test-Path $ownerCredentialPath)) {
    throw 'Memory Bridge autostart is not configured. Run bridge\windows\install-autostart.cmd first.'
}
if (!(Test-Path $rotationHelper)) {
    throw 'Credential rotation helper is missing. Run git pull before rotating the bridge credential.'
}

$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
$ownerToken = Read-ProtectedToken $ownerCredentialPath
$oldAdminToken = if (Test-Path $adminCredentialPath) { Read-ProtectedToken $adminCredentialPath } else { $ownerToken }

$bytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
} finally {
    $rng.Dispose()
}
$newAdminToken = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$secureNewAdminToken = ConvertTo-SecureString $newAdminToken -AsPlainText -Force
$newAdminCredential = New-Object System.Management.Automation.PSCredential('memory-bridge-admin', $secureNewAdminToken)
$newAdminCredential | Export-Clixml -Path $adminCredentialTempPath

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
$previousRotateOwnerOauth = $env:MEMORY_BRIDGE_ROTATE_OWNER_OAUTH

try {
    $env:MEMORY_BRIDGE_OLD_TOKEN = $oldAdminToken
    $env:MEMORY_BRIDGE_NEW_TOKEN = $newAdminToken
    $env:MEMORY_BRIDGE_CONNECTION_STATE_FILE = $connectionStateFile
    $env:MEMORY_BRIDGE_OAUTH_STATE_FILE = $oauthStateFile
    $env:MEMORY_BRIDGE_ROTATE_OWNER_OAUTH = '0'

    $rotationOutput = & $nodePath $rotationHelper
    if ($LASTEXITCODE -ne 0) {
        throw 'Bridge administrator state rotation failed. The stored Windows administrator credential was not changed.'
    }

    Move-Item -Force -Path $adminCredentialTempPath -Destination $adminCredentialPath
} catch {
    Remove-Item -Force -Path $adminCredentialTempPath -ErrorAction SilentlyContinue
    if ($task) { Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    throw
} finally {
    if ($null -eq $previousOld) { Remove-Item Env:MEMORY_BRIDGE_OLD_TOKEN -ErrorAction SilentlyContinue } else { $env:MEMORY_BRIDGE_OLD_TOKEN = $previousOld }
    if ($null -eq $previousNew) { Remove-Item Env:MEMORY_BRIDGE_NEW_TOKEN -ErrorAction SilentlyContinue } else { $env:MEMORY_BRIDGE_NEW_TOKEN = $previousNew }
    if ($null -eq $previousConnectionState) { Remove-Item Env:MEMORY_BRIDGE_CONNECTION_STATE_FILE -ErrorAction SilentlyContinue } else { $env:MEMORY_BRIDGE_CONNECTION_STATE_FILE = $previousConnectionState }
    if ($null -eq $previousOauthState) { Remove-Item Env:MEMORY_BRIDGE_OAUTH_STATE_FILE -ErrorAction SilentlyContinue } else { $env:MEMORY_BRIDGE_OAUTH_STATE_FILE = $previousOauthState }
    if ($null -eq $previousRotateOwnerOauth) { Remove-Item Env:MEMORY_BRIDGE_ROTATE_OWNER_OAUTH -ErrorAction SilentlyContinue } else { $env:MEMORY_BRIDGE_ROTATE_OWNER_OAUTH = $previousRotateOwnerOauth }
}

Start-ScheduledTask -TaskName $TaskName

$healthy = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $headers = @{ Authorization = "Bearer $newAdminToken" }
        $info = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/v1/info" -Headers $headers -TimeoutSec 2
        if ($info.protocol -eq 'memory-space-bridge') {
            $healthy = $true
            break
        }
    } catch {}
}

if (!$healthy) {
    throw 'The administrator credential was rotated, but the Memory Bridge did not become healthy within 20 seconds. Check bridge\.state\windows-autostart.log.'
}

Write-Host 'Memory Bridge administrator credential rotated successfully.'
Write-Host 'Existing owner bridge credential was retained, so the owner app should stay connected.'
Write-Host 'Private MSB2 customer credentials and tenant OAuth state were preserved.'
if ($rotationOutput) { Write-Host "Rotation state: $rotationOutput" }
