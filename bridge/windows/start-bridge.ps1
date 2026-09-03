$ErrorActionPreference = 'Stop'

$bridgeDir = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $bridgeDir '.state'
$configPath = Join-Path $stateDir 'windows-runtime.json'
$credentialPath = Join-Path $stateDir 'windows-token.clixml'
$adminCredentialPath = Join-Path $stateDir 'windows-admin-token.clixml'
$legacyOwnerDisabledFlag = Join-Path $stateDir 'legacy-owner-disabled.flag'
$logPath = Join-Path $stateDir 'windows-autostart.log'

function Write-BridgeLog([string]$Message) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $logPath -Value "[$stamp] [launcher] $Message" -Encoding UTF8
}

function Set-BridgeEnvironment([string]$Name, $Value) {
    $text = if ($null -eq $Value) { '' } else { [string]$Value }
    if ([string]::IsNullOrWhiteSpace($text)) {
        Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
    } else {
        Set-Item "Env:$Name" $text
    }
}

function Read-ProtectedToken([string]$Path) {
    $credential = Import-Clixml -Path $Path
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function New-EphemeralOwnerToken {
    $bytes = New-Object byte[] 48
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

if (!(Test-Path $configPath)) {
    throw 'Memory Bridge autostart is not configured. Run bridge\windows\install-autostart.cmd once.'
}
if (!(Test-Path $adminCredentialPath) -and !(Test-Path $credentialPath)) {
    throw 'Memory Bridge has no protected administrator credential.'
}

$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
$legacyOwnerDisabled = Test-Path $legacyOwnerDisabledFlag
$adminToken = if (Test-Path $adminCredentialPath) { Read-ProtectedToken $adminCredentialPath } else { Read-ProtectedToken $credentialPath }

if ($legacyOwnerDisabled) {
    $ownerToken = New-EphemeralOwnerToken
} else {
    if (!(Test-Path $credentialPath)) {
        throw 'Memory Bridge owner credential is missing. Either restore it or complete the legacy-owner retirement.'
    }
    $ownerToken = Read-ProtectedToken $credentialPath
}

$env:MEMORY_BRIDGE_TOKEN = $ownerToken
$env:MEMORY_BRIDGE_OWNER_TOKEN = $ownerToken
$env:MEMORY_BRIDGE_ADMIN_TOKEN = $adminToken
Set-BridgeEnvironment 'MEMORY_BRIDGE_MODEL' $config.model
Set-BridgeEnvironment 'MEMORY_BRIDGE_TARGET' $config.target
Set-BridgeEnvironment 'MEMORY_BRIDGE_HOST' $config.host
Set-BridgeEnvironment 'MEMORY_BRIDGE_PORT' $config.port
Set-BridgeEnvironment 'MEMORY_BRIDGE_NAME' $config.name
Set-BridgeEnvironment 'MEMORY_BRIDGE_PUBLIC_URL' $config.publicUrl
Set-BridgeEnvironment 'MEMORY_BRIDGE_OAUTH_CLIENT_ID' $config.oauthClientId
Set-BridgeEnvironment 'MEMORY_BRIDGE_OAUTH_REDIRECT_HOSTS' $config.oauthRedirectHosts
Set-BridgeEnvironment 'MEMORY_BRIDGE_ORIGINS' $config.origins
Set-BridgeEnvironment 'MEMORY_BRIDGE_OAUTH_STATE_FILE' $config.oauthStateFile

$nodePath = [string]$config.nodePath
$serverPath = Join-Path $bridgeDir 'server.mjs'
$port = if ($config.port) { [int]$config.port } else { 8787 }

function Test-MemoryBridgeRunning {
    try {
        $headers = @{ Authorization = "Bearer $adminToken" }
        $info = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/v1/info" -Headers $headers -TimeoutSec 2
        return $info.protocol -eq 'memory-space-bridge'
    } catch {
        return $false
    }
}

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$ownerMode = if ($legacyOwnerDisabled) { 'retired/ephemeral' } else { 'legacy-enabled' }
Write-BridgeLog "autostart supervisor online node=$nodePath port=$port ownerMode=$ownerMode"

while ($true) {
    if (Test-MemoryBridgeRunning) {
        Start-Sleep -Seconds 15
        continue
    }

    Write-BridgeLog 'starting Memory Bridge'
    try {
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & $nodePath $serverPath >> $logPath 2>&1
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        Write-BridgeLog "Memory Bridge exited code=$exitCode; retrying in 10 seconds"
    } catch {
        Write-BridgeLog "launcher error: $($_.Exception.Message); retrying in 10 seconds"
    }
    Start-Sleep -Seconds 10
}
