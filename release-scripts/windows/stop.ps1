[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ReleaseDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$BundleEnvPath = Join-Path $ReleaseDir 'bundle.env'
$BaseEnvPath = Join-Path $ReleaseDir '.env'
$RunDir = Join-Path $ReleaseDir 'run'
$BackendPidFile = Join-Path $RunDir 'backend.pid'
$FrontendContainerFile = Join-Path $RunDir 'frontend.container'

function Load-DotEnv([string]$Path) {
  $result = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) {
      continue
    }
    $parts = $line.Split('=', 2)
    if ($parts.Count -eq 2) {
      $result[$parts[0]] = $parts[1]
    }
  }
  return $result
}

if (Test-Path -LiteralPath $FrontendContainerFile) {
  $containerName = (Get-Content -LiteralPath $FrontendContainerFile -Raw).Trim()
  if (-not [string]::IsNullOrWhiteSpace($containerName)) {
    docker rm -f $containerName *> $null
  }
  Remove-Item -LiteralPath $FrontendContainerFile -Force -ErrorAction SilentlyContinue
} elseif ((Test-Path -LiteralPath $BundleEnvPath) -and (Test-Path -LiteralPath $BaseEnvPath)) {
  $bundle = Load-DotEnv $BundleEnvPath
  $envs = Load-DotEnv $BaseEnvPath
  if ($envs.ContainsKey('FRONTEND_PORT')) {
    $containerName = "{0}-{1}" -f $bundle['FRONTEND_CONTAINER_NAME_PREFIX'], $envs['FRONTEND_PORT']
    docker rm -f $containerName *> $null
  }
}

if (Test-Path -LiteralPath $BackendPidFile) {
  $pidValue = (Get-Content -LiteralPath $BackendPidFile -Raw).Trim()
  if (-not [string]::IsNullOrWhiteSpace($pidValue)) {
    Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $BackendPidFile -Force -ErrorAction SilentlyContinue
}

Write-Host '[stop] term-webclient stopped'
