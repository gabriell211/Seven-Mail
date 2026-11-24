# Apply the narrowly scoped MSVC debug-format fix to the locked source in
# an isolated CI Cargo home. The OpenSSL implementation is not changed.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This preparation is Windows-only' }

# Use a private registry cache so other projects/builds are unaffected.
$env:CARGO_HOME = Join-Path $env:RUNNER_TEMP 'seven-mail-desktop-cargo'
New-Item -ItemType Directory -Path $env:CARGO_HOME -Force | Out-Null
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Locked Cargo fetch failed' }
$json = cargo metadata --locked --all-features --manifest-path src-tauri/Cargo.toml --format-version 1
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
# Cargo's published source may already omit the PDB installation recipe.
# Match the recipe by its commands, not by indentation or CRLF/LF formatting.
function Remove-StaticPdbInstall([string] $Source) {
    $pattern = '(?im)^[ \t]*@?if[ \t]+"\$\(SHLIBS\)"[ \t]*==[ \t]*""[ \t]*\\[ \t]*\r?\n[ \t]*"?\$\(PERL\)"?[ \t]+"?\$\(SRCDIR\)[\\/]util[\\/]copy\.pl"?[ \t]+"?ossl_static\.pdb"?[ \t]+"?\$\(libdir\)"?[ \t]*(?:\r?\n|$)'
    $matches = [regex]::Matches($Source, $pattern)
    if ($matches.Count -gt 1) { throw 'Multiple OpenSSL static PDB install recipes' }
    $result = [regex]::Replace($Source, $pattern, '')
    # Cleanup references are harmless. An unrecognized installation command
    # must not be silently left behind.
    $remaining = @($result -split '\r?\n' | Where-Object {
        $_ -match '(?i)ossl_static\.pdb' -and $_ -notmatch '^\s*[-@]*\s*del\b'
    })
    if ($remaining.Count -ne 0) {
        throw ("Unexpected OpenSSL PDB references: " + ($remaining -join ' | '))
    }
    return $result
}

# Test both newline conventions, flexible recipe indentation and an upstream
# template that has already removed the installation command.
$recipe = @'
	@if "$(SHLIBS)"=="" \
	  "$(PERL)" "$(SRCDIR)\util\copy.pl" ossl_static.pdb "$(libdir)"
'@
$lf = $recipe.Replace("`r`n", "`n") + "`n"
$crlf = $lf.Replace("`n", "`r`n")
foreach ($fixture in @($lf, $crlf, $lf.Replace("`t", '    '))) {
    if ((Remove-StaticPdbInstall $fixture) -ne '') { throw 'Static PDB recipe self-test failed' }
}
$cleanup = '	-del /Q /F $(LIBS) libcrypto.* libssl.* ossl_static.pdb'
if ((Remove-StaticPdbInstall $cleanup) -ne $cleanup) { throw 'Static PDB cleanup self-test failed' }

$templateSource = [IO.File]::ReadAllText($template)
$templatePatched = Remove-StaticPdbInstall $templateSource
if ($templatePatched -ne $templateSource) {
    [IO.File]::WriteAllText($template, $templatePatched, [Text.UTF8Encoding]::new($false))
    Write-Host 'Removed external static PDB install recipe.'
} else {
    Write-Host 'Published OpenSSL template already has no external static PDB install recipe.'
}
# Force a rebuild from the prepared source; no stale compiled PDB references.
cargo clean --locked --manifest-path src-tauri/Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Cargo clean failed' }
Write-Host 'OpenSSL MSVC static objects configured for embedded /Z7 symbols.'
