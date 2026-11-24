# Apply the narrowly scoped MSVC debug-format fix to the locked source in
# an isolated CI Cargo home. The OpenSSL implementation is not changed.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This preparation is Windows-only' }

# Use a private registry cache so other projects/builds are unaffected.
$env:CARGO_HOME = Join-Path $env:RUNNER_TEMP 'seven-mail-sqlcipher-cargo'
New-Item -ItemType Directory -Path $env:CARGO_HOME -Force | Out-Null
cargo fetch --locked
if ($LASTEXITCODE -ne 0) { throw 'Locked Cargo fetch failed' }
$json = cargo metadata --locked --all-features --format-version 1
if ($LASTEXITCODE -ne 0) { throw 'Locked Cargo metadata failed' }
$metadata = $json | ConvertFrom-Json
$packages = @($metadata.packages | Where-Object { $_.name -eq 'openssl-src' })
if ($packages.Count -ne 1 -or $packages[0].version -ne '300.6.1+3.6.3') {
    throw 'OpenSSL source version changed; review the MSVC patch before building'
}
$root = Join-Path (Split-Path $packages[0].manifest_path -Parent) 'openssl'
$config = Join-Path $root 'Configurations/10-main.conf'
$template = Join-Path $root 'Configurations/windows-makefile.tmpl'

function Replace-ExactlyOnce([string] $Path, [string] $Before, [string] $After) {
    $source = [IO.File]::ReadAllText($Path)
    # Preserve the original line-ending convention for upstream files.
    if ($source.Contains("`r`n")) {
        $Before = $Before.Replace("`r`n", "`n").Replace("`n", "`r`n")
        $After = $After.Replace("`r`n", "`n").Replace("`n", "`r`n")
    }
    $first = $source.IndexOf($Before, [StringComparison]::Ordinal)
    if ($first -lt 0 -or $source.IndexOf($Before, $first + $Before.Length, [StringComparison]::Ordinal) -ge 0) {
        throw "Unexpected OpenSSL source layout: $Path"
    }
    [IO.File]::WriteAllText($Path, $source.Replace($Before, $After), [Text.UTF8Encoding]::new($false))
}

# /Z7 puts debug information into each object instead of a compiler PDB.
Replace-ExactlyOnce $config '/Zi /Fdossl_static.pdb' '/Z7'
# Static-library installation must no longer require that external PDB.
$old = @'
	@if "$(SHLIBS)"=="" \
	 "$(PERL)" "$(SRCDIR)\util\copy.pl" ossl_static.pdb "$(libdir)"
'@
# Include its trailing newline, otherwise the make recipe has a blank line.
Replace-ExactlyOnce $template ($old + "`n") ''
# Force a rebuild from the prepared source; no stale compiled PDB references.
cargo clean --locked
if ($LASTEXITCODE -ne 0) { throw 'Cargo clean failed' }
Write-Host 'OpenSSL MSVC static objects configured for embedded /Z7 symbols.'
