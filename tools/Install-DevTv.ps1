<#
.SYNOPSIS
    Installs the RingCast app (lg-tv package) on an LG TV in Developer Mode and starts it.

.DESCRIPTION
    Uses the official LG webOS CLI (@webos-tools/cli). If it isn't installed next to this script
    (folder lg-cli), the script installs it there with npm; nothing is installed globally.

    Before you run it, on the TV (see README.txt, "Developer Mode"):
      - install the "Developer Mode" app from the LG Content Store and sign in with your
        LG developer account;
      - turn Dev Mode Status ON (the TV restarts), then turn Key Server ON;
      - note the TV's IP address and the passphrase the Developer Mode app shows.

    Steps: checks Node.js and npm, installs the LG CLI if needed, registers the TV
    (ares-setup-device, user prisoner, port 9922), fetches the TV's key with the passphrase
    (ares-novacom --getkey), checks the connection, installs the package (ares-install),
    starts it (ares-launch) and verifies that it is installed and running.

.PARAMETER TvIp
    The TV's IP address (shown in the Developer Mode app). Asked for when omitted.

.PARAMETER Ipk
    The package to install. Default: the newest ringcast-webos-*-lg-tv.ipk next to this script
    or in ..\dist.

.PARAMETER DeviceName
    The name the LG CLI uses for the TV. Default: ringcast-tv.

.PARAMETER SkipKey
    Don't fetch the key again (the TV was already registered by an earlier run and its
    Developer Mode passphrase hasn't changed).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\Install-DevTv.ps1 -TvIp 192.0.2.50
#>

# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 NetRing Tech Services, LLC
[CmdletBinding()]
param(
    [string]$TvIp,
    [string]$Ipk,
    [string]$DeviceName = "ringcast-tv",
    [switch]$SkipKey
)

$ErrorActionPreference = "Stop"
$AppId = "com.netringtech.ringcast"
$CliVersion = "3.2.6"
$CliDir = Join-Path $PSScriptRoot "lg-cli"
$Bin = Join-Path $CliDir "node_modules\.bin"

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "== $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
    Write-Host "   OK  $Text" -ForegroundColor Green
}

function Stop-WithError([string]$Text) {
    Write-Host ""
    Write-Host "ERROR: $Text" -ForegroundColor Red
    exit 1
}

# Runs a native program; returns its exit code. Its own output goes to the console.
function Invoke-Native([string]$Exe, [string[]]$Arguments, [string]$InputText) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        if ($PSBoundParameters.ContainsKey("InputText")) {
            $InputText | & $Exe @Arguments | Out-Host
        } else {
            & $Exe @Arguments | Out-Host
        }
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
}

# Runs a native program and returns its output as text (exit code in $script:LastCode).
function Get-NativeOutput([string]$Exe, [string[]]$Arguments) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $out = & $Exe @Arguments 2>&1 | ForEach-Object { "$_" }
        $script:LastCode = $LASTEXITCODE
        return ($out -join "`n")
    } finally {
        $ErrorActionPreference = $old
    }
}

function Get-Cli([string]$Name) {
    $p = Join-Path $Bin "$Name.cmd"
    if (-not (Test-Path $p)) { Stop-WithError "$Name not found in $Bin" }
    return $p
}

Write-Host "RingCast for LG webOS: install on a TV in Developer Mode" -ForegroundColor White

# 1. Node.js and npm ---------------------------------------------------------------------------
Write-Step "Checking Node.js and npm"
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
    Stop-WithError "Node.js (with npm) is required. Install the LTS version from https://nodejs.org, open a new PowerShell window and run this script again."
}
$nodeVersion = (Get-NativeOutput "node" @("--version")).Trim()
if ($nodeVersion -notmatch '^v(\d+)\.') { Stop-WithError "Couldn't read the Node.js version ('$nodeVersion')." }
if ([int]$Matches[1] -lt 20) {
    Stop-WithError "The LG CLI needs Node.js 20 or newer; this PC has $nodeVersion. Install the LTS version from https://nodejs.org."
}
Write-Ok "Node.js $nodeVersion"

# 2. The package --------------------------------------------------------------------------------
Write-Step "Finding the package"
if (-not $Ipk) {
    $candidates = @()
    foreach ($dir in @($PSScriptRoot, (Join-Path $PSScriptRoot "..\dist"))) {
        if (Test-Path $dir) {
            $candidates += Get-ChildItem -Path $dir -Filter "ringcast-webos-*-lg-tv.ipk" -File -ErrorAction SilentlyContinue
        }
    }
    if ($candidates.Count -eq 0) {
        Stop-WithError "No ringcast-webos-*-lg-tv.ipk next to this script or in ..\dist. Copy it here or pass -Ipk <file>."
    }
    $Ipk = ($candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (-not (Test-Path $Ipk -PathType Leaf)) { Stop-WithError "Package not found: $Ipk" }
$Ipk = (Resolve-Path $Ipk).Path
if ($Ipk -notmatch '-lg-tv\.ipk$') {
    Write-Host "   Note: $Ipk is not the lg-tv package; standard TVs should get the lg-tv one." -ForegroundColor Yellow
}
Write-Ok "$Ipk ($((Get-Item $Ipk).Length) bytes)"

# 3. LG CLI ---------------------------------------------------------------------------------------
Write-Step "Checking the LG webOS CLI"
if (-not (Test-Path (Join-Path $Bin "ares-install.cmd"))) {
    Write-Host "   Installing @webos-tools/cli $CliVersion into $CliDir (one time, needs internet)..."
    New-Item -ItemType Directory -Force -Path $CliDir | Out-Null
    $code = Invoke-Native "npm" @("install", "--prefix", $CliDir, "--no-audit", "--no-fund", "@webos-tools/cli@$CliVersion")
    if ($code -ne 0) { Stop-WithError "npm couldn't install the LG CLI (exit $code). Check the internet connection or proxy settings." }
}
$setup = Get-Cli "ares-setup-device"
$novacom = Get-Cli "ares-novacom"
$device = Get-Cli "ares-device"          # ares-device-info is retired in the current CLI
$install = Get-Cli "ares-install"
$launch = Get-Cli "ares-launch"
Write-Ok "LG CLI in $CliDir"

# 4. The TV -----------------------------------------------------------------------------------------
Write-Step "Connecting to the TV"
while (-not $TvIp -or $TvIp -notmatch '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') {
    if ($TvIp) { Write-Host "   '$TvIp' isn't an IPv4 address." -ForegroundColor Yellow }
    $TvIp = "$(Read-Host "   TV IP address (shown in the Developer Mode app)")".Trim()
}
$sshOpen = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $wait = $tcp.BeginConnect($TvIp, 9922, $null, $null)
    $sshOpen = $wait.AsyncWaitHandle.WaitOne(4000, $false) -and $tcp.Connected
    $tcp.Close()
} catch {
    $sshOpen = $false
}
if (-not $sshOpen) {
    Stop-WithError "The TV at $TvIp doesn't answer on port 9922. Check that the PC and the TV are on the same network, that the Developer Mode app shows Dev Mode Status ON, and that the IP address is the one it shows."
}
Write-Ok "TV answers at ${TvIp}:9922"

$list = Get-NativeOutput $setup @("--list")
$escapedName = [regex]::Escape($DeviceName)
$mode = if ($list -match "(?m)^\s*$escapedName\b") { "--modify" } else { "--add" }
$code = Invoke-Native $setup @($mode, $DeviceName, "-i", "username=prisoner", "-i", "host=$TvIp", "-i", "port=9922")
if ($code -ne 0) { Stop-WithError "ares-setup-device failed (exit $code)." }
Write-Ok "TV registered as '$DeviceName'"

if (-not $SkipKey) {
    Write-Host "   On the TV, Key Server must be ON in the Developer Mode app."
    $pass = ""
    while ($pass -notmatch '^[A-Za-z0-9]{6,}$') {
        $pass = "$(Read-Host "   Passphrase shown in the Developer Mode app (case-sensitive)")".Trim()
    }
    # Passed with --passphrase: when it is piped in, the CLI can exit before reading it and then
    # never saves the key and passphrase (exit code 0 all the same).
    $code = Invoke-Native $novacom @("--device", $DeviceName, "--getkey", "--passphrase", $pass)
    if ($code -ne 0) {
        Stop-WithError "Couldn't get the key from the TV (exit $code). Turn Key Server ON in the Developer Mode app and check the passphrase."
    }
    $list = Get-NativeOutput $setup @("--list")
    if ($list -notmatch "(?m)^\s*$escapedName\s.*\s$([regex]::Escape($pass))\s*$") {
        Write-Host $list
        Stop-WithError "The LG CLI didn't save the key for '$DeviceName'. Run the script again (Key Server ON)."
    }
    Write-Ok "Key received and saved"
}

$info = Get-NativeOutput $device @("--device", $DeviceName, "--system-info")
if ($script:LastCode -ne 0) {
    Write-Host $info
    Stop-WithError "The CLI can't log in to the TV. Run the script again without -SkipKey, and check the passphrase."
}
Write-Ok "Logged in to the TV"
$info -split "`n" | Where-Object { $_ -match '^(modelName|sdkVersion|firmwareVersion|webos_build_id)' } |
    ForEach-Object { Write-Host "      $_" }

# 5. Install and start --------------------------------------------------------------------------
Write-Step "Installing $([System.IO.Path]::GetFileName($Ipk))"
$code = Invoke-Native $install @("--device", $DeviceName, $Ipk)
if ($code -ne 0) { Stop-WithError "ares-install failed (exit $code)." }
Write-Ok "Installed"

Write-Step "Starting RingCast"
$code = Invoke-Native $launch @("--device", $DeviceName, $AppId)
if ($code -ne 0) { Stop-WithError "ares-launch failed (exit $code)." }

# 6. Verify -------------------------------------------------------------------------------------
Write-Step "Verifying"
$installed = Get-NativeOutput $install @("--device", $DeviceName, "--list")
if ($installed -notmatch [regex]::Escape($AppId)) { Stop-WithError "$AppId isn't in the TV's list of installed apps." }
Write-Ok "$AppId is installed"
Start-Sleep -Seconds 3
$running = Get-NativeOutput $launch @("--device", $DeviceName, "--running")
if ($running -match [regex]::Escape($AppId)) {
    Write-Ok "$AppId is running"
} else {
    Write-Host "   The app isn't listed as running; start it from the TV's app list (RingCast)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. On the TV: enter the server address (https://...), then add the screen in the" -ForegroundColor White
Write-Host "dashboard with the code it shows (Screens > Add Screen)." -ForegroundColor White
Write-Host "Developer Mode sessions last 50 hours: open the Developer Mode app and choose EXTEND" -ForegroundColor White
Write-Host "before it runs out, or the TV removes the app." -ForegroundColor White
