# Legt die EuroScope-SDK-Dateien als GitHub-Secrets ab, damit GitHub die Releases bauen kann.
# Die Dateien werden gepackt (gzip), als Base64 in Stuecke unter 48 KB geteilt (Grenze je Secret)
# und als ES_SDK_H_1..4 und ES_SDK_LIB_1..4 gespeichert. Sie kommen nie ins Repo.
#
# Aufruf in der PowerShell im Repo-Ordner:
#   powershell -ExecutionPolicy Bypass -File tools\set-sdk-secrets.ps1
# Voraussetzung: GitHub-Kommandozeile installiert und angemeldet (winget install --id GitHub.cli, dann gh auth login)
param(
  [string]$SdkDir = "$env:APPDATA\EuroScope\PlugIn",
  [string]$Repo = "bzoeller/eddm-aman"
)
$ErrorActionPreference = 'Stop'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "Die GitHub-Kommandozeile (gh) fehlt. Installieren mit:  winget install --id GitHub.cli" -ForegroundColor Red
  Write-Host "Danach ein neues PowerShell-Fenster oeffnen und  gh auth login  ausfuehren." -ForegroundColor Red
  exit 1
}
& gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Bei GitHub noch nicht angemeldet. Bitte zuerst:  gh auth login" -ForegroundColor Red
  exit 1
}

function Pack([string]$path) {
  $bytes = [IO.File]::ReadAllBytes($path)
  $ms = New-Object IO.MemoryStream
  $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress)
  $gz.Write($bytes, 0, $bytes.Length)
  $gz.Close()
  return [Convert]::ToBase64String($ms.ToArray())
}

$max = 4      # so viele Stuecke liest der Release-Workflow
$size = 30000   # unter der Grenze von 48 KB je Secret
$files = @(
  @{ File = 'EuroScopePlugIn.h';      Name = 'ES_SDK_H' },
  @{ File = 'EuroScopePlugInDll.lib'; Name = 'ES_SDK_LIB' }
)
foreach ($f in $files) {
  $path = Join-Path $SdkDir $f.File
  if (-not (Test-Path $path)) {
    Write-Host "Nicht gefunden: $path  (anderen Ordner angeben: -SdkDir 'C:\...')" -ForegroundColor Red
    exit 1
  }
  $b64 = Pack $path
  $n = [int][Math]::Ceiling($b64.Length / $size)
  if ($n -gt $max) { Write-Host "$($f.File) ist zu gross ($n Teile)" -ForegroundColor Red; exit 1 }
  for ($i = 1; $i -le $max; $i++) {
    $secret = "$($f.Name)_$i"
    if ($i -le $n) {
      $start = ($i - 1) * $size
      $part = $b64.Substring($start, [Math]::Min($size, $b64.Length - $start))
      # ueber die Standardeingabe (eine Befehlszeile waere unter Windows zu lang)
      $part | & gh secret set $secret --repo $Repo
      if ($LASTEXITCODE -ne 0) { Write-Host "Speichern von $secret fehlgeschlagen" -ForegroundColor Red; exit 1 }
    } else {
      # Reste eines frueheren Laufs entfernen (Fehler, wenn es das Secret nicht gibt, ist egal)
      try { & gh secret delete $secret --repo $Repo 2>&1 | Out-Null } catch { }
    }
  }
  Write-Host ("{0}: {1} KB, gespeichert als {2}_1 bis {2}_{3}" -f $f.File, [int]((Get-Item $path).Length / 1024), $f.Name, $n) -ForegroundColor Green
}
Write-Host "Fertig. Die Secrets stehen unter https://github.com/$Repo/settings/secrets/actions" -ForegroundColor Green
