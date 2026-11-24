# Report the size of the Rust target dir and clean it when needed.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/clean-target.ps1 [-Clean]

param([switch]$Clean)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root '.cargo/config.toml'
$targetDir = 'C:\cargo-target\gitpanel'

if (Test-Path $configPath) {
    $line = Select-String -Path $configPath -Pattern 'target-dir\s*=\s*"([^"]+)"' | Select-Object -First 1
    if ($line) { $targetDir = $line.Matches[0].Groups[1].Value }
}

if (Test-Path $targetDir) {
    $size = (Get-ChildItem $targetDir -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    Write-Host ("target dir : {0}" -f $targetDir)
    Write-Host ("size       : {0:N2} GB" -f ($size / 1GB))
} else {
    Write-Host ("target dir : {0} (not created yet)" -f $targetDir)
}

if ($Clean) {
    Push-Location $root
    try {
        cargo clean
        Write-Host 'target dir cleaned.' -ForegroundColor Green
    } finally {
        Pop-Location
    }
}
