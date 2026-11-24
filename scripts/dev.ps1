# Start the local dev environment:
#   1) dev bridge (Node, port 7717) - proxies real `git` data
#   2) Vite dev server (port 5173)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/dev.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

Write-Host '[gitpanel] starting dev bridge on http://127.0.0.1:7717 ...' -ForegroundColor Cyan
$bridge = Start-Process -FilePath 'node' -ArgumentList 'devserver/server.mjs' -WorkingDirectory $root -PassThru -WindowStyle Hidden

try {
    Write-Host '[gitpanel] starting vite on http://127.0.0.1:5273 ...' -ForegroundColor Cyan
    pnpm exec vite
}
finally {
    if ($bridge -and -not $bridge.HasExited) {
        Stop-Process -Id $bridge.Id -Force -ErrorAction SilentlyContinue
    }
    Pop-Location
}
