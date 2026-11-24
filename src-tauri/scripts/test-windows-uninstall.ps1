# Run only on a disposable Windows CI runner.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This test requires a disposable GitHub-hosted Windows runner.'
}
$bundle = Join-Path $PSScriptRoot '../target/release/bundle'
$nsis = @(Get-ChildItem (Join-Path $bundle 'nsis') -File -Filter '*-setup.exe')
$msi = @(Get-ChildItem (Join-Path $bundle 'msi') -File -Filter '*.msi')
if ($nsis.Count -ne 1 -or $msi.Count -ne 1) { throw 'Expected one installer per format.' }

function Get-SevenMailRegistration {
    $roots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    @(Get-ItemProperty -Path $roots -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq 'Seven Mail' })
}
function Invoke-CheckedProcess([string] $File, [string] $Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer process failed: $($process.ExitCode)" }
}
function Assert-Removed([string] $Executable, [string] $Uninstaller = '') {
    # NSIS copies itself to a temporary process during removal.
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (-not (Test-Path -LiteralPath $Executable) -and
            (-not $Uninstaller -or -not (Test-Path -LiteralPath $Uninstaller)) -and
            @(Get-SevenMailRegistration).Count -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw 'Application, uninstaller or Add/Remove Programs registration remains.'
}
if (@(Get-SevenMailRegistration).Count -ne 0) { throw 'Runner already has Seven Mail installed.' }

# Seven Mail uses a roaming data directory independent of the installation.
$data = Join-Path $env:APPDATA 'Seven Mail'
$existingData = Test-Path -LiteralPath $data
New-Item -ItemType Directory -Path $data -Force | Out-Null
$sentinel = Join-Path $data ("ci-preserve-" + [guid]::NewGuid().ToString() + ".txt")
Set-Content -LiteralPath $sentinel -Value 'preserve user data' -NoNewline
$hash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash
function Assert-DataPreserved {
    if (-not (Test-Path -LiteralPath $sentinel) -or
        (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $hash) {
        throw 'Uninstallation changed the user data sentinel.'
    }
}

try {
    # NSIS /D must be the final argument and must not be quoted.
    $installDir = Join-Path $env:RUNNER_TEMP 'seven-mail-nsis-install'
    $app = Join-Path $installDir 'seven-mail.exe'
    $uninstaller = Join-Path $installDir 'uninstall.exe'
    Invoke-CheckedProcess $nsis[0].FullName "/S /D=$installDir"
    if (-not (Test-Path -LiteralPath $app) -or -not (Test-Path -LiteralPath $uninstaller)) {
        throw 'NSIS must install both the desktop executable and uninstall.exe.'
    }
    $registration = @(Get-SevenMailRegistration)
    if ($registration.Count -ne 1 -or
        $registration[0].UninstallString -notlike "*$uninstaller*") {
        throw 'NSIS uninstall registration missing or invalid.'
    }
    Invoke-CheckedProcess $uninstaller '/S'
    Assert-Removed $app $uninstaller
    Assert-DataPreserved
    Write-Host 'NSIS install/uninstall, registry cleanup and data preservation passed.'

    $msiPath = $msi[0].FullName
    $msiDir = Join-Path $env:RUNNER_TEMP 'seven-mail-msi-install'
    $installLog = Join-Path $env:RUNNER_TEMP 'seven-mail-msi-install.log'
    $removeLog = Join-Path $env:RUNNER_TEMP 'seven-mail-msi-uninstall.log'
    Invoke-CheckedProcess 'msiexec.exe' ('/i "{0}" /qn /norestart INSTALLDIR="{1}" /L*v "{2}"' -f $msiPath,$msiDir,$installLog)
    $registration = @(Get-SevenMailRegistration)
    if ($registration.Count -ne 1 -or $registration[0].WindowsInstaller -ne 1) {
        throw 'MSI uninstall registration missing or invalid.'
    }
    # WiX can restore a previous NSIS/MSI installation directory from the registry.
    # ARPINSTALLLOCATION is set by the official Tauri WiX template.
    $location = ([string]$registration[0].InstallLocation).Trim().Trim('"')
    if (-not $location -or -not [IO.Path]::IsPathFullyQualified($location)) {
        throw 'MSI did not register an absolute installation location.'
    }
    $msiApp = Join-Path $location 'seven-mail.exe'
    Write-Host "MSI registered installation location: $location"
    if (-not (Test-Path -LiteralPath $msiApp -PathType Leaf)) { throw "MSI executable missing at registered location: $msiApp" }
    $built = Join-Path $PSScriptRoot '../target/release/seven-mail.exe'
    if ((Get-FileHash -LiteralPath $msiApp -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $built -Algorithm SHA256).Hash) {
        throw 'MSI installed executable differs from the compiled executable.'
    }
    Invoke-CheckedProcess 'msiexec.exe' ('/x "{0}" /qn /norestart /L*v "{1}"' -f $msiPath,$removeLog)
    Assert-Removed $msiApp
    Assert-DataPreserved
    Write-Host 'MSI install/uninstall, registry cleanup and data preservation passed.'
} finally {
    Remove-Item -LiteralPath $sentinel -Force -ErrorAction SilentlyContinue
    if (-not $existingData -and (Test-Path -LiteralPath $data) -and
        @(Get-ChildItem -LiteralPath $data -Force).Count -eq 0) {
        Remove-Item -LiteralPath $data
    }
}
