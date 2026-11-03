# QuickerAtlas — extraction des données (v0.6.8), lancée par la tâche planifiée « QuickerAtlas - extraction »
# (outils\planifier-extraction.ps1) toutes les 2 semaines, ou à la main :
#     powershell -ExecutionPolicy Bypass -File outils\extraction.ps1 [-SansPush]
#
# Étapes : mise à jour du dépôt (main) → python -m etl update → python -m pytest → commit des fichiers data/ →
# push sur main (GitHub Pages se met à jour en ~1 min). Rien n'est publié si les tests échouent.
# Une source en échec n'arrête pas les autres (ses anciennes données sont gardées) : le message de commit le dit.
#
# Pourquoi sur ce PC et pas sur un serveur (GitHub Actions, session infonuagique) : les serveurs du MTMD (fiches APEX,
# OData, transports.gouv.qc.ca) et Québec 511 refusent les adresses IP de centres de données (403 vérifié le
# 2026-11-03) ; seule une connexion résidentielle passe.
param([switch]$SansPush)

$ErrorActionPreference = 'Continue'
$racine = Split-Path -Parent $PSScriptRoot
Set-Location $racine
$jour = Get-Date -Format 'yyyy-MM-dd'
New-Item -ItemType Directory -Force -Path (Join-Path $racine 'data\raw') | Out-Null
$journal = Join-Path $racine "data\raw\extraction-$jour.log"     # data/raw/ n'est pas versionné
$env:PYTHONIOENCODING = 'utf-8'

function Ecrire($texte) {
    $ligne = "$(Get-Date -Format 'HH:mm:ss') $texte"
    Write-Host $ligne
    Add-Content -Path $journal -Value $ligne -Encoding UTF8
}
function Lancer([string]$exe, [string[]]$arguments) {
    & $exe @arguments *>&1 | ForEach-Object { Add-Content -Path $journal -Value "$_" -Encoding UTF8 }
    return $LASTEXITCODE
}

Ecrire "Extraction QuickerAtlas du $jour (dépôt : $racine)"
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { Ecrire 'ERREUR : python introuvable (installer Python 3.12+ et cocher « Add to PATH »)'; exit 2 }

# 1. Dépôt à jour, sur main, sans modification locale en cours
$branche = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branche -ne 'main') { Ecrire "ERREUR : le dépôt est sur la branche « $branche » (main attendue) : rien n'est fait"; exit 3 }
if (git status --porcelain --untracked-files=no) { Ecrire 'ERREUR : modifications locales non validées : rien n est fait (les valider ou les annuler)'; exit 3 }
if ((Lancer 'git' @('pull', '--ff-only', 'origin', 'main')) -ne 0) { Ecrire 'ERREUR : git pull impossible'; exit 4 }

# 2. Dépendances, extraction complète (sources + consolidation + export + couches), tests
Lancer $py @('-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt') | Out-Null
$codeEtl = Lancer $py @('-m', 'etl', 'update')
Ecrire "python -m etl update : code $codeEtl$(if ($codeEtl -ne 0) { ' (au moins une source ou couche en échec : voir le journal)' })"
$codeTests = Lancer $py @('-m', 'pytest', '-q')
Ecrire "python -m pytest : code $codeTests"
if ($codeTests -ne 0) { Ecrire 'ERREUR : tests en échec : rien n est publié'; exit 5 }

# 3. Commit des seules données générées, puis push
git add -- data/*.js data/sismique 2>$null
if (-not (git diff --cached --name-only)) { Ecrire 'Aucune donnée modifiée : rien à publier'; exit 0 }
$message = "Données : extraction du $jour"
if ($codeEtl -ne 0) { $message += ' (sources ou couches en échec, anciennes données gardées)' }
if ((Lancer 'git' @('commit', '-q', '-m', $message)) -ne 0) { Ecrire 'ERREUR : commit impossible'; exit 6 }
Ecrire "Commit : $message"
if ($SansPush) { Ecrire 'Push non fait (-SansPush)'; exit 0 }
if ((Lancer 'git' @('push', 'origin', 'main')) -ne 0) { Ecrire 'ERREUR : push impossible (connexion GitHub ?)'; exit 7 }
Ecrire 'Push fait : GitHub Pages sera à jour dans ~1 min'
exit 0
