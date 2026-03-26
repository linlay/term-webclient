$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$Version = if ($env:VERSION) { $env:VERSION } else { (Get-Content (Join-Path $RepoRoot 'VERSION') -Raw).Trim() }
$env:VERSION = $Version
$env:TARGET_OS = 'windows'
if (-not $env:ARCH) {
  $env:ARCH = 'amd64'
}
bash (Join-Path $RepoRoot 'scripts/release.sh')
