# QuickerAtlas — planifie l'extraction des données toutes les 2 semaines (v0.6.8), à partir d'aujourd'hui.
#     powershell -ExecutionPolicy Bypass -File outils\planifier-extraction.ps1 [-Heure 12:15] [-PasMaintenant]
# (ou double-clic sur outils\planifier-extraction.cmd)
#
# - Tâche « QuickerAtlas - extraction » du Planificateur de tâches Windows, pour l'utilisateur courant (pas de mot de
#   passe demandé : elle tourne quand la session est ouverte) ;
# - toutes les 2 semaines, le même jour de la semaine qu'aujourd'hui, à l'heure choisie ; un PC éteint à l'heure
#   prévue la rattrape dès qu'il est rallumé ;
# - lancée une première fois tout de suite (sauf -PasMaintenant) : c'est l'extraction « d'aujourd'hui ».
# Relancer ce script remplace la tâche (changer l'heure, réparer). Supprimer : Unregister-ScheduledTask "QuickerAtlas - extraction"
param([string]$Heure = '12:15', [switch]$PasMaintenant)

$nom = 'QuickerAtlas - extraction'
$script = Join-Path $PSScriptRoot 'extraction.ps1'
$racine = Split-Path -Parent $PSScriptRoot

# Anciennes tâches du projet (autre nom, autre fréquence) : signalées, à retirer à la main au besoin
Get-ScheduledTask -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -ne $nom -and ($_.TaskName -match 'QuickerAtlas|PontsQC|etl' -or ($_.Actions.Arguments -match 'etl update')) } |
    ForEach-Object { Write-Warning "Autre tâche du projet trouvée : « $($_.TaskName) » ($($_.State)). Pour la retirer : Unregister-ScheduledTask '$($_.TaskName)'" }

$debut = [datetime]::ParseExact((Get-Date -Format 'yyyy-MM-dd') + ' ' + $Heure, 'yyyy-MM-dd HH:mm', $null)
$declencheur = New-ScheduledTaskTrigger -Weekly -WeeksInterval 2 -DaysOfWeek $debut.DayOfWeek -At $debut
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $racine `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $nom -Trigger $declencheur -Action $action -Settings $reglages -Principal $principal `
    -Description "Extraction des données ouvertes de QuickerAtlas (python -m etl update) puis publication sur GitHub Pages. Journal : data\raw\extraction-AAAA-MM-JJ.log" -Force | Out-Null

$t = Get-ScheduledTask -TaskName $nom | Get-ScheduledTaskInfo
Write-Host "Tâche « $nom » enregistrée : toutes les 2 semaines, le $($debut.ToString('dddd')) à $Heure (prochaine : $($t.NextRunTime))."
if (-not $PasMaintenant) {
    Start-ScheduledTask -TaskName $nom
    Write-Host "Première extraction lancée maintenant (2 à 5 min). Journal : $racine\data\raw\extraction-$(Get-Date -Format 'yyyy-MM-dd').log"
}
