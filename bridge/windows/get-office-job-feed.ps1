$ErrorActionPreference = 'Stop'

$bridgeDir = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $bridgeDir '.state'
$configPath = Join-Path $stateDir 'windows-runtime.json'
$credentialPath = Join-Path $stateDir 'windows-token.clixml'
$adminCredentialPath = Join-Path $stateDir 'windows-admin-token.clixml'

function Read-ProtectedToken([string]$Path) {
    $credential = Import-Clixml -Path $Path
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if (!(Test-Path $configPath)) {
    throw 'Memory Bridge autostart is not configured.'
}
if (!(Test-Path $adminCredentialPath) -and !(Test-Path $credentialPath)) {
    throw 'Memory Bridge has no protected administrator credential.'
}

$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
$credentialFile = if (Test-Path $adminCredentialPath) { $adminCredentialPath } else { $credentialPath }
$adminToken = Read-ProtectedToken $credentialFile
$port = if ($config.port) { [int]$config.port } else { 8787 }

try {
    $access = Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:$port/v1/jobs/access" `
        -Headers @{ Authorization = "Bearer $adminToken" } `
        -ContentType 'application/json' `
        -Body '{}' `
        -TimeoutSec 5
    if ([string]::IsNullOrWhiteSpace([string]$access.token)) {
        throw 'Memory Bridge returned incomplete Office job-feed access.'
    }
    # Office and Bridge are co-located in the Worker App suite. Avoid making
    # this private handoff depend on the public tunnel being available.
    [PSCustomObject]@{
        url = "http://127.0.0.1:$port/v1/jobs"
        token = [string]$access.token
    } | ConvertTo-Json -Compress
} finally {
    Remove-Variable adminToken -ErrorAction SilentlyContinue
}
