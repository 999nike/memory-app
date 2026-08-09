[CmdletBinding()]
param(
    [string]$TaskName = 'Memory Space Bridge',
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'

$bridgeDir = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $bridgeDir '.state'
$launcherPath = Join-Path $PSScriptRoot 'start-bridge.ps1'
$setupPath = Join-Path $PSScriptRoot 'show-access-code.ps1'
$configPath = Join-Path $stateDir 'windows-runtime.json'
$credentialPath = Join-Path $stateDir 'windows-token.clixml'
$adminCredentialPath = Join-Path $stateDir 'windows-admin-token.clixml'

if ([string]::IsNullOrWhiteSpace($env:MEMORY_BRIDGE_TOKEN)) {
    throw 'MEMORY_BRIDGE_TOKEN is not set in this terminal. Start from the same terminal/config used for the working bridge.'
}
if ([string]::IsNullOrWhiteSpace($env:MEMORY_BRIDGE_MODEL)) {
    throw 'MEMORY_BRIDGE_MODEL is not set in this terminal. Start from the same terminal/config used for the working bridge.'
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodePath = $nodeCommand.Source
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$secureToken = ConvertTo-SecureString $env:MEMORY_BRIDGE_TOKEN -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential('memory-bridge-owner', $secureToken)
$credential | Export-Clixml -Path $credentialPath

if (![string]::IsNullOrWhiteSpace($env:MEMORY_BRIDGE_ADMIN_TOKEN)) {
    $secureAdminToken = ConvertTo-SecureString $env:MEMORY_BRIDGE_ADMIN_TOKEN -AsPlainText -Force
    $adminCredential = New-Object System.Management.Automation.PSCredential('memory-bridge-admin', $secureAdminToken)
    $adminCredential | Export-Clixml -Path $adminCredentialPath
} elseif (!(Test-Path $adminCredentialPath)) {
    $adminCredential = New-Object System.Management.Automation.PSCredential('memory-bridge-admin', $secureToken)
    $adminCredential | Export-Clixml -Path $adminCredentialPath
}

$config = [ordered]@{
    version = 1
    nodePath = $nodePath
    model = $env:MEMORY_BRIDGE_MODEL
    target = if ($env:MEMORY_BRIDGE_TARGET) { $env:MEMORY_BRIDGE_TARGET } else { 'http://127.0.0.1:11434/v1/chat/completions' }
    host = if ($env:MEMORY_BRIDGE_HOST) { $env:MEMORY_BRIDGE_HOST } else { '127.0.0.1' }
    port = if ($env:MEMORY_BRIDGE_PORT) { [int]$env:MEMORY_BRIDGE_PORT } else { 8787 }
    name = if ($env:MEMORY_BRIDGE_NAME) { $env:MEMORY_BRIDGE_NAME } else { 'Memory Bridge' }
    publicUrl = if ($env:MEMORY_BRIDGE_PUBLIC_URL) { $env:MEMORY_BRIDGE_PUBLIC_URL } else { 'https://bridge.w-i-z-z-lab-studios.com' }
    oauthClientId = if ($env:MEMORY_BRIDGE_OAUTH_CLIENT_ID) { $env:MEMORY_BRIDGE_OAUTH_CLIENT_ID } else { 'memory-space-grok' }
    oauthRedirectHosts = if ($env:MEMORY_BRIDGE_OAUTH_REDIRECT_HOSTS) { $env:MEMORY_BRIDGE_OAUTH_REDIRECT_HOSTS } else { 'grok.com,x.ai,chatgpt.com,openai.com,claude.ai' }
    origins = if ($env:MEMORY_BRIDGE_ORIGINS) { $env:MEMORY_BRIDGE_ORIGINS } else { 'https://memory-app-ashy-one.vercel.app' }
    oauthStateFile = if ($env:MEMORY_BRIDGE_OAUTH_STATE_FILE) { $env:MEMORY_BRIDGE_OAUTH_STATE_FILE } else { '' }
    installedFor = $currentUser
    installedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json -Depth 4 | Set-Content -Path $configPath -Encoding UTF8

$actionArgs = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcherPath`""
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $actionArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Starts and supervises the local Memory Space bridge after Windows sign-in.'
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Memory Space'
$shortcutPath = Join-Path $startMenuDir 'Memory Bridge Setup.lnk'
New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$setupPath`""
$shortcut.WorkingDirectory = $bridgeDir
$shortcut.Description = 'Show the private access code used to connect Memory Space to this bridge.'
$shortcut.Save()

Write-Host "Memory Space Bridge autostart installed for $currentUser"
Write-Host "Runtime config: $configPath"
Write-Host 'Owner and administrator credentials: encrypted with Windows user protection (DPAPI)'
Write-Host "Task: $TaskName"
Write-Host 'Start menu: Memory Space -> Memory Bridge Setup'

if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host 'Autostart supervisor launched. It will take over automatically if no healthy bridge is already running.'
}
