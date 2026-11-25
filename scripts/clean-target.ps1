# Report the size of the Rust target dir and clean it when needed.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/clean-target.ps1 [-Clean]

param([switch]$Clean)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$targetDir = $env:CARGO_TARGET_DIR
if (-not $targetDir) {
    # 与 scripts/with-cargo-target.mjs 保持一致：Windows 用 C 盘 SSD，其它平台用默认 target/
    if ($env:OS -eq 'Windows_NT') { $targetDir = 'C:\cargo-target\gitpanel' }
    else { $targetDir = Join-Path $root 'target' }
}
# 让下面的 cargo clean 也作用于同一个目录
$env:CARGO_TARGET_DIR = $targetDir

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
