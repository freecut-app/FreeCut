# Baixa os recursos nativos do FreeCut para a pasta resources/ (não versionados no Git):
#   - ffmpeg/ffprobe (BtbN FFmpeg-Builds, GPL)       -> resources/bin
#   - whisper.cpp b5454 CPU e CUDA 12.4               -> resources/whisper/cpu e cuda
#   - modelos Whisper small-q5_1 e large-v3-turbo-q5_0 -> resources/models
# Uso: powershell -ExecutionPolicy Bypass -File scripts/setup-resources.ps1 [-SemCuda] [-SemTurbo]
param([switch]$SemCuda, [switch]$SemTurbo)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$res = Join-Path $root 'resources'
$tmp = Join-Path $env:TEMP 'freecut-setup'
New-Item -ItemType Directory -Force $res, $tmp, "$res\bin", "$res\whisper", "$res\models" | Out-Null

function Baixar($url, $dest) {
  if (Test-Path $dest) { Write-Host "  já existe: $(Split-Path $dest -Leaf)"; return }
  Write-Host "  baixando $(Split-Path $dest -Leaf)..."
  & curl.exe -L --fail --retry 3 -o "$dest.part" $url
  if ($LASTEXITCODE -ne 0) { throw "falha ao baixar $url" }
  Move-Item "$dest.part" $dest
}
function Extrair($zip, $nome) {
  $d = Join-Path $tmp $nome
  if (Test-Path $d) { Remove-Item -Recurse -Force $d }
  Expand-Archive -Path $zip -DestinationPath $d
  return $d
}

Write-Host '[1/3] ffmpeg'
if (-not (Test-Path "$res\bin\ffmpeg.exe")) {
  $z = Join-Path $tmp 'ffmpeg.zip'
  Baixar 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' $z
  $d = Extrair $z 'ffmpeg'
  Get-ChildItem $d -Recurse -Include ffmpeg.exe, ffprobe.exe | Copy-Item -Destination "$res\bin"
}

Write-Host '[2/3] whisper.cpp'
$wurl = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454'
$alvos = @(@{ n = 'cpu'; f = 'whisper-bin-x64.zip' })
if (-not $SemCuda) { $alvos += @{ n = 'cuda'; f = 'whisper-bin-win-cuda-12.4.0-x64.zip' } }
foreach ($a in $alvos) {
  $dest = "$res\whisper\$($a.n)"
  if (Test-Path "$dest\whisper-cli.exe") { Write-Host "  já existe: whisper $($a.n)"; continue }
  $z = Join-Path $tmp $a.f
  Baixar "$wurl/$($a.f)" $z
  $d = Extrair $z "whisper-$($a.n)"
  $cli = Get-ChildItem $d -Recurse -Filter whisper-cli.exe | Select-Object -First 1
  New-Item -ItemType Directory -Force $dest | Out-Null
  Copy-Item "$($cli.DirectoryName)\*" $dest -Recurse -Force
}

Write-Host '[3/3] modelos Whisper'
$hf = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
Baixar "$hf/ggml-small-q5_1.bin" "$res\models\ggml-small-q5_1.bin"
if (-not $SemTurbo) { Baixar "$hf/ggml-large-v3-turbo-q5_0.bin" "$res\models\ggml-large-v3-turbo-q5_0.bin" }

Write-Host "Pronto. Recursos em $res"
