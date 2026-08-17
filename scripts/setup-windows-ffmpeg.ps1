param(
  [string]$InstallDir = "tools\ffmpeg"
)

$ErrorActionPreference = "Stop"
$downloadDir = "work\downloads"
$zipPath = Join-Path $downloadDir "ffmpeg-release-essentials.zip"
$shaPath = Join-Path $downloadDir "ffmpeg-release-essentials.zip.sha256"
$zipUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$shaUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256"

New-Item -ItemType Directory -Force -Path $downloadDir, $InstallDir | Out-Null

function Download-FileWithNode($Url, $OutFile) {
  $nodeScript = @"
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
const response = await fetch('$Url', { redirect: 'follow' });
if (!response.ok) throw new Error('$Url HTTP ' + response.status);
await pipeline(response.body, createWriteStream('$OutFile'.replace(/\\/g, '/')));
"@
  $nodeScript | node --input-type=module
}

Write-Host "Downloading FFmpeg checksum..."
Download-FileWithNode $shaUrl $shaPath
Write-Host "Downloading FFmpeg portable build..."
Download-FileWithNode $zipUrl $zipPath

$expected = (Get-Content -LiteralPath $shaPath -Raw).Trim().Split(' ')[0].ToLowerInvariant()
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
if ($expected -ne $actual) {
  throw "FFmpeg checksum mismatch. Expected $expected but got $actual"
}

Expand-Archive -LiteralPath $zipPath -DestinationPath $InstallDir -Force
$ffmpeg = Get-ChildItem -LiteralPath $InstallDir -Recurse -Filter ffmpeg.exe | Select-Object -First 1
if (-not $ffmpeg) { throw "ffmpeg.exe was not found after extraction" }

$envPath = ".env"
if (Test-Path -LiteralPath $envPath) {
  $envText = Get-Content -LiteralPath $envPath -Raw
  if ($envText -match "(?m)^FFMPEG_PATH=") {
    $envText = $envText -replace "(?m)^FFMPEG_PATH=.*$", "FFMPEG_PATH=$($ffmpeg.FullName)"
  } else {
    $envText += "`nFFMPEG_PATH=$($ffmpeg.FullName)`n"
  }
  Set-Content -LiteralPath $envPath -Value $envText -Encoding UTF8
}

Write-Host "FFmpeg installed at $($ffmpeg.FullName)"
& $ffmpeg.FullName -version | Select-Object -First 1
