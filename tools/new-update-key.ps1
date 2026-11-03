# Richtet die Signatur der Updates ein (einmalig, fuer den Betreuer):
#  1. legt bei GitHub das Environment "release" an: jeder Release wartet auf deine Freigabe,
#     und nur dann kommt der Workflow an den geheimen Schluessel
#  2. erzeugt ein Schluesselpaar (ECDSA P-256) auf diesem Rechner
#  3. speichert den geheimen Schluessel als Secret UPDATE_SIGNING_KEY in diesem Environment (nicht im Repo)
#  4. zeigt den oeffentlichen Schluessel an und legt ihn in tools\update-public-key.txt ab;
#     er kommt ins Repo und in jedes Plugin
#
# Aufruf in der PowerShell im Repo-Ordner:
#   powershell -ExecutionPolicy Bypass -File tools\new-update-key.ps1
# Voraussetzung: GitHub-Kommandozeile installiert und angemeldet (wie bei set-sdk-secrets.ps1)
#
# ACHTUNG: Nur einmal ausfuehren. Ein neuer Schluessel passt nicht zu den schon installierten Plugins,
# die bekommen dann keine Updates mehr. Erneut nur mit -Force (z. B. wenn der Schluessel verloren ist).
param(
  [string]$Repo = "bzoeller/eddm-aman",
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "Die GitHub-Kommandozeile (gh) fehlt. Installieren mit:  winget install --id GitHub.cli" -ForegroundColor Red
  exit 1
}
& gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Bei GitHub noch nicht angemeldet. Bitte zuerst:  gh auth login" -ForegroundColor Red; exit 1 }

# 1) Environment "release" mit dir als Freigeber, nur fuer main und Tags v*
$me = (& gh api user | ConvertFrom-Json)
if (-not $me.id) { Write-Host "GitHub-Konto nicht lesbar" -ForegroundColor Red; exit 1 }
$body = @{
  reviewers = @(@{ type = 'User'; id = [int64]$me.id })
  deployment_branch_policy = @{ protected_branches = $false; custom_branch_policies = $true }
} | ConvertTo-Json -Depth 5
$body | & gh api -X PUT "repos/$Repo/environments/release" --input - | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "Environment 'release' konnte nicht angelegt werden" -ForegroundColor Red; exit 1 }
foreach ($p in @(@{ name = 'main'; type = 'branch' }, @{ name = 'v*'; type = 'tag' })) {
  # existiert die Regel schon, meldet GitHub einen Fehler: egal
  & gh api -X POST "repos/$Repo/environments/release/deployment-branch-policies" -f "name=$($p.name)" -f "type=$($p.type)" 2>&1 | Out-Null
}
Write-Host "Environment 'release' eingerichtet (Freigabe durch $($me.login))." -ForegroundColor Green

# Schluessel schon vorhanden? Dann nicht ueberschreiben
$existing = (& gh secret list --env release --repo $Repo 2>$null) -join "`n"
if ($existing -match 'UPDATE_SIGNING_KEY' -and -not $Force) {
  Write-Host "Es gibt schon einen Update-Schluessel. Nichts geaendert (neu nur mit -Force, siehe Hinweis oben im Skript)." -ForegroundColor Yellow
  exit 0
}

# 2) Schluesselpaar erzeugen (Windows-Kryptografie, laeuft in Windows PowerShell und PowerShell 7)
$params = New-Object System.Security.Cryptography.CngKeyCreationParameters
$params.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::AllowPlaintextExport
$key = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::ECDsaP256, $null, $params)
$priv = $key.Export([System.Security.Cryptography.CngKeyBlobFormat]::Pkcs8PrivateBlob)
$blob = $key.Export([System.Security.Cryptography.CngKeyBlobFormat]::EccPublicBlob)   # 8 Byte Kopf, dann X und Y
$pubHex = ([BitConverter]::ToString($blob, 8, 64)).Replace('-', '').ToLower()
$key.Dispose()

# 3) geheimer Schluessel als Secret, ueber die Standardeingabe (landet nicht in der Befehlszeile)
[Convert]::ToBase64String($priv) | & gh secret set UPDATE_SIGNING_KEY --env release --repo $Repo
if ($LASTEXITCODE -ne 0) { Write-Host "Speichern des Secrets fehlgeschlagen" -ForegroundColor Red; exit 1 }
[Array]::Clear($priv, 0, $priv.Length)

# 4) oeffentlicher Schluessel
$out = Join-Path $PSScriptRoot 'update-public-key.txt'
Set-Content -Path $out -Value $pubHex -Encoding ascii -NoNewline
Write-Host ""
Write-Host "Fertig. Der geheime Schluessel liegt nur bei GitHub (Environment 'release')." -ForegroundColor Green
Write-Host "Oeffentlicher Schluessel (bitte an Claude schicken, er kommt ins Repo):" -ForegroundColor Green
Write-Host $pubHex
