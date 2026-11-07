<#
  Starts the whole AvatarForge stack for local development:
    1. PostgreSQL (inside WSL Ubuntu on this machine — see docs/api-platform.md)
    2. ASP.NET Core API on http://localhost:5080 (applies migrations + syncs the asset catalog on boot)
    3. Next.js web app on http://localhost:3000
  Usage:  powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Starting PostgreSQL (WSL)..." -ForegroundColor Cyan
wsl -d Ubuntu -u root -- service postgresql start | Out-Host

if (-not (Test-Path (Join-Path $root "api\server-assets\avatar-base-poc.glb"))) {
  Write-Host "Building server assets for the render pipeline..." -ForegroundColor Cyan
  Push-Location $root; npm run assets:server | Out-Host; Pop-Location
}

Write-Host "Starting API on http://localhost:5080 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; npm run api" | Out-Null

Write-Host "Starting web app on http://localhost:3000 ..." -ForegroundColor Cyan
Set-Location $root
npm run dev
