[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ReleaseDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$BundleEnvPath = Join-Path $ReleaseDir 'bundle.env'
$BaseEnvPath = Join-Path $ReleaseDir '.env'
$RunDir = Join-Path $ReleaseDir 'run'
$LogDir = Join-Path $ReleaseDir 'logs'
$BackendPidFile = Join-Path $RunDir 'backend.pid'
$FrontendContainerFile = Join-Path $RunDir 'frontend.container'
$BackendLogFile = Join-Path $LogDir 'backend.out'

function Fail([string]$Message) {
  Write-Error "[start] $Message"
  exit 1
}

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

function Get-ProcessFromPidFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  $pidValue = (Get-Content -LiteralPath $Path -Raw).Trim()
  if ([string]::IsNullOrWhiteSpace($pidValue)) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    return $null
  }
  try {
    return Get-Process -Id ([int]$pidValue) -ErrorAction Stop
  } catch {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    return $null
  }
}

if (-not (Test-Path -LiteralPath $BundleEnvPath)) { Fail "missing bundle metadata: $BundleEnvPath" }
if (-not (Test-Path -LiteralPath $BaseEnvPath)) { Fail "missing required config: $BaseEnvPath" }

$bundle = Load-DotEnv $BundleEnvPath
$envs = Load-DotEnv $BaseEnvPath

$backendBinary = Join-Path $ReleaseDir ($bundle['BACKEND_BINARY'])
$frontendImageArchive = Join-Path $ReleaseDir ($bundle['FRONTEND_IMAGE_ARCHIVE'])
$frontendImageTag = $bundle['FRONTEND_IMAGE_TAG']
$frontendPrefix = $bundle['FRONTEND_CONTAINER_NAME_PREFIX']
$backendPort = [int]$envs['BACKEND_PORT']
$frontendPort = [int]$envs['FRONTEND_PORT']
$backendBindHost = if ($envs.ContainsKey('BACKEND_BIND_HOST')) { $envs['BACKEND_BIND_HOST'] } else { '0.0.0.0' }
$frontendHost = if ($envs.ContainsKey('FRONTEND_HOST')) { $envs['FRONTEND_HOST'] } else { '0.0.0.0' }
$backendArgs = @("--server.address=$backendBindHost", "--server.port=$backendPort")
$frontendContainerName = "$frontendPrefix-$frontendPort"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'docker not found; install Docker Desktop first' }
docker info | Out-Null
if (-not (Test-Path -LiteralPath $backendBinary)) { Fail "missing backend binary: $backendBinary" }
if (-not (Test-Path -LiteralPath $frontendImageArchive)) { Fail "missing frontend image archive: $frontendImageArchive" }

New-Item -ItemType Directory -Force -Path $RunDir, $LogDir, (Join-Path $ReleaseDir 'data') | Out-Null

$existingBackend = Get-ProcessFromPidFile $BackendPidFile
if ($null -ne $existingBackend) {
  Fail "backend is already running (pid=$($existingBackend.Id))"
}

$staleContainer = if (Test-Path -LiteralPath $FrontendContainerFile) { (Get-Content -LiteralPath $FrontendContainerFile -Raw).Trim() } else { '' }
if (-not [string]::IsNullOrWhiteSpace($staleContainer)) {
  $running = docker inspect --format '{{.State.Running}}' $staleContainer 2>$null
  if ($LASTEXITCODE -eq 0 -and $running -eq 'true') {
    Fail "frontend container already running ($staleContainer)"
  }
  Remove-Item -LiteralPath $FrontendContainerFile -Force -ErrorAction SilentlyContinue
}

docker container inspect $frontendContainerName *> $null
if ($LASTEXITCODE -eq 0) {
  docker rm -f $frontendContainerName | Out-Null
}

docker load -i $frontendImageArchive | Out-Null

if ($envs.ContainsKey('BACKEND_ARGS') -and -not [string]::IsNullOrWhiteSpace($envs['BACKEND_ARGS'])) {
  $backendArgs += ($envs['BACKEND_ARGS'] -split '\s+')
}

$backend = Start-Process -FilePath $backendBinary -ArgumentList $backendArgs -WorkingDirectory $ReleaseDir -RedirectStandardOutput $BackendLogFile -RedirectStandardError $BackendLogFile -PassThru
$backend.Id | Set-Content -LiteralPath $BackendPidFile
Start-Sleep -Seconds 1
if ($backend.HasExited) {
  Remove-Item -LiteralPath $BackendPidFile -Force -ErrorAction SilentlyContinue
  Fail "backend failed to start; see $BackendLogFile"
}

$publishSpec = "{0}:{1}:11947" -f $frontendHost, $frontendPort
docker run -d --name $frontendContainerName -p $publishSpec -e HOST=0.0.0.0 -e PORT=11947 -e BACKEND_PORT=$backendPort -e BACKEND_ORIGIN="http://host.docker.internal:$backendPort" $frontendImageTag | Out-Null
if ($LASTEXITCODE -ne 0) {
  Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $BackendPidFile -Force -ErrorAction SilentlyContinue
  Fail "frontend container failed to start"
}

$frontendContainerName | Set-Content -LiteralPath $FrontendContainerFile
Write-Host "[start] backend pid=$($backend.Id) http://127.0.0.1:$backendPort"
Write-Host "[start] frontend container=$frontendContainerName http://127.0.0.1:$frontendPort"
