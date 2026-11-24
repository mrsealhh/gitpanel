# Regenerate the app icon source (assets/icon.png) from code.
# Keeps the icon in sync with the product theme: brand gradient #5B9DFF -> #8B5CF6
# on a #0B0D12 rounded tile, with a git-branch glyph.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
#        pnpm tauri icon assets/icon.png

Add-Type -AssemblyName System.Drawing

$S = 1024
$root = Split-Path -Parent $PSScriptRoot
$outFile = Join-Path $root 'assets/icon.png'
New-Item -ItemType Directory -Force (Join-Path $root 'assets') | Out-Null

$bmp = New-Object System.Drawing.Bitmap($S, $S)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedRect([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $r * 2, $r * 2, 180, 90)
    $p.AddArc($x + $w - $r * 2, $y, $r * 2, $r * 2, 270, 90)
    $p.AddArc($x + $w - $r * 2, $y + $h - $r * 2, $r * 2, $r * 2, 0, 90)
    $p.AddArc($x, $y + $h - $r * 2, $r * 2, $r * 2, 90, 90)
    $p.CloseFigure()
    return $p
}

$bg = New-RoundedRect 0 0 $S $S 232
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(0, $S)),
    [System.Drawing.Color]::FromArgb(255, 18, 23, 36),
    [System.Drawing.Color]::FromArgb(255, 8, 10, 16))
$g.FillPath($bgBrush, $bg)

$brand = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 120)),
    (New-Object System.Drawing.Point(0, $S)),
    [System.Drawing.Color]::FromArgb(255, 91, 157, 255),
    [System.Drawing.Color]::FromArgb(255, 139, 92, 246))

$pen = New-Object System.Drawing.Pen($brand, 78)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

# main trunk
$g.DrawLine($pen, 352, 250, 352, 774)

# branch: curve out of the trunk and drop to the right node
$branchPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$branchPath.AddBezier(352, 430, 352, 552, 688, 486, 688, 600)
$branchPath.AddLine(688, 600, 688, 774)
$g.DrawPath($pen, $branchPath)

$nodePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 8, 10, 16), 34)
$nodePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
foreach ($pt in @(@(352, 250), @(688, 774), @(352, 774))) {
    $rect = New-Object System.Drawing.RectangleF(($pt[0] - 76), ($pt[1] - 76), 152, 152)
    $g.FillEllipse($brand, $rect)
    $g.DrawEllipse($nodePen, $rect)
}

$bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $pen.Dispose(); $brand.Dispose(); $bgBrush.Dispose()
Write-Host "icon written: $outFile"
