$ErrorActionPreference = 'Stop'

$bridgeDir = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $bridgeDir '.state'
$configPath = Join-Path $stateDir 'windows-runtime.json'
$credentialPath = Join-Path $stateDir 'windows-token.clixml'
$adminCredentialPath = Join-Path $stateDir 'windows-admin-token.clixml'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Show-ErrorMessage([string]$Message) {
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        'Memory Bridge Setup',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
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

try {
    if (!(Test-Path $configPath) -or (!(Test-Path $credentialPath) -and !(Test-Path $adminCredentialPath))) {
        throw 'Memory Bridge is not configured yet. Run the Memory Space Bridge installer first.'
    }

    $config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
    $adminToken = if (Test-Path $adminCredentialPath) {
        Read-ProtectedToken $adminCredentialPath
    } else {
        Read-ProtectedToken $credentialPath
    }

    $port = if ($config.port) { [int]$config.port } else { 8787 }
    $bridgeName = if ($config.name) { [string]$config.name } else { 'My Memory Bridge' }
    $headers = @{ Authorization = "Bearer $adminToken" }
    $connection = Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:$port/v1/connections" `
        -Headers $headers `
        -ContentType 'application/json' `
        -Body (@{ name = $bridgeName } | ConvertTo-Json -Compress) `
        -TimeoutSec 5

    if (!$connection.connectionId -or !$connection.accessCode) {
        throw 'Memory Bridge did not create a private customer connection. Restart the bridge and try again.'
    }

    $connectionId = [string]$connection.connectionId
    $accessCode = [string]$connection.accessCode

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Memory Bridge Setup'
    $form.StartPosition = 'CenterScreen'
    $form.Size = New-Object System.Drawing.Size(620, 300)
    $form.MinimumSize = New-Object System.Drawing.Size(540, 280)
    $form.MaximizeBox = $false

    $title = New-Object System.Windows.Forms.Label
    $title.Text = 'Connect Memory Space'
    $title.Font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
    $title.AutoSize = $true
    $title.Location = New-Object System.Drawing.Point(22, 18)
    $form.Controls.Add($title)

    $help = New-Object System.Windows.Forms.Label
    $help.Text = 'Copy this private access code and paste it into Memory Space. Treat it like a password.'
    $help.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $help.AutoSize = $true
    $help.Location = New-Object System.Drawing.Point(24, 58)
    $form.Controls.Add($help)

    $codeBox = New-Object System.Windows.Forms.TextBox
    $codeBox.Text = $accessCode
    $codeBox.ReadOnly = $true
    $codeBox.Multiline = $true
    $codeBox.ScrollBars = 'Vertical'
    $codeBox.Font = New-Object System.Drawing.Font('Consolas', 9)
    $codeBox.Location = New-Object System.Drawing.Point(26, 92)
    $codeBox.Size = New-Object System.Drawing.Size(550, 82)
    $codeBox.Anchor = 'Top,Left,Right'
    $form.Controls.Add($codeBox)

    $status = New-Object System.Windows.Forms.Label
    $status.Text = 'This code is unique to one private customer connection.'
    $status.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $status.AutoSize = $true
    $status.Location = New-Object System.Drawing.Point(26, 185)
    $form.Controls.Add($status)

    $copyButton = New-Object System.Windows.Forms.Button
    $copyButton.Text = 'Copy private access code'
    $copyButton.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $copyButton.Size = New-Object System.Drawing.Size(220, 38)
    $copyButton.Location = New-Object System.Drawing.Point(26, 214)
    $copyButton.Add_Click({
        [System.Windows.Forms.Clipboard]::SetText($accessCode)
        $status.Text = 'Copied. Paste it into Memory Space.'
    })
    $form.Controls.Add($copyButton)

    $closeButton = New-Object System.Windows.Forms.Button
    $closeButton.Text = 'Close'
    $closeButton.Size = New-Object System.Drawing.Size(100, 38)
    $closeButton.Location = New-Object System.Drawing.Point(476, 214)
    $closeButton.Anchor = 'Bottom,Right'
    $closeButton.Add_Click({ $form.Close() })
    $form.Controls.Add($closeButton)

    $form.ShowDialog() | Out-Null
} catch {
    Show-ErrorMessage ($_.Exception.Message)
    exit 1
}
