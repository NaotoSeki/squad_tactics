# 9router ローカルプロキシ起動（Platoon Leader RE 用）
# Usage: .\scripts\start_9router.ps1
#        .\scripts\start_9router.ps1 -Port 20128 -NoBrowser

param(
    [int]$Port = 20128,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command 9router -ErrorAction SilentlyContinue)) {
    Write-Host "9router not found. Installing globally..." -ForegroundColor Yellow
    npm install -g 9router
}

if (-not (Get-Command 9router -ErrorAction SilentlyContinue)) {
    throw "9router install failed. Check npm global bin is on PATH."
}

# Cursor OAuth auto-import on Windows (Dashboard -> Connect Cursor)
if (-not (npm list -g better-sqlite3 2>$null)) {
    Write-Host "Installing better-sqlite3 (Cursor OAuth import)..." -ForegroundColor Yellow
    npm install -g better-sqlite3 | Out-Null
}

$args = @("--port", $Port, "--skip-update")
if ($NoBrowser) { $args += "--no-browser" }

Write-Host ""
Write-Host "Starting 9router on http://localhost:$Port" -ForegroundColor Cyan
Write-Host "Dashboard: http://localhost:$Port/dashboard" -ForegroundColor Cyan
Write-Host "Setup doc: docs/9ROUTER_CURSOR_SETUP.md" -ForegroundColor DarkGray
Write-Host ""

& 9router @args
