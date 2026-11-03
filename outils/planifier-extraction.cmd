@echo off
rem QuickerAtlas : double-clic = planifie l'extraction toutes les 2 semaines et la lance une premiere fois maintenant.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0planifier-extraction.ps1" %*
pause
