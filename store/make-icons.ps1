# Draws the extension icons into icons/: an indigo tile with three lines of text,
# the middle one highlighted in yellow.
# 16 px has its own pixel-aligned design so it stays crisp in the toolbar; 32 and
# 48 scale the main design. 128 is also the Chrome Web Store icon, which should be
# 96x96 artwork with 16 px of transparent padding on each side.
Add-Type -AssemblyName System.Drawing
$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

$INDIGO = [System.Drawing.Color]::FromArgb(255, 79, 70, 229)    # #4F46E5
$YELLOW = [System.Drawing.Color]::FromArgb(255, 255, 214, 10)   # #FFD60A
$INK = [System.Drawing.Color]::FromArgb(255, 30, 27, 75)        # #1E1B4B
$WHITE = [System.Drawing.Color]::White

# Shapes as [x, y, width, height, radius, color] on a square grid of $grid units.
# Main design (96 units): multiples of 6, so 32 px (/3) and 48 px (/2) land on whole pixels.
$main = @{
  grid = 96
  shapes = @(
    @(0, 0, 96, 96, 24, $INDIGO),   # tile
    @(18, 18, 60, 12, 6, $WHITE),   # line
    @(12, 36, 72, 24, 7, $YELLOW),  # highlight
    @(18, 42, 48, 12, 6, $INK),     # highlighted line
    @(18, 66, 42, 12, 6, $WHITE)    # line
  )
}
# 16 px design (16 units): whole-pixel edges.
$small = @{
  grid = 16
  shapes = @(
    @(0, 0, 16, 16, 3.5, $INDIGO),
    @(3, 3, 10, 2, 1, $WHITE),
    @(2, 6, 12, 4, 1.5, $YELLOW),
    @(3, 7, 8, 2, 1, $INK),
    @(3, 11, 7, 2, 1, $WHITE)
  )
}

function Add-RoundRect($path, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $d = [Math]::Min($r * 2, [Math]::Min($w, $h))
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
}

function Draw-Icon([int]$size, [int]$pad, $design) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $scale = ($size - 2 * $pad) / $design.grid
  foreach ($s in $design.shapes) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundRect $path ($pad + $s[0] * $scale) ($pad + $s[1] * $scale) ($s[2] * $scale) ($s[3] * $scale) ($s[4] * $scale)
    $brush = New-Object System.Drawing.SolidBrush $s[5]
    $g.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()
  }
  $bmp.Save((Join-Path $outDir "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

Draw-Icon 16 0 $small
Draw-Icon 32 0 $main
Draw-Icon 48 0 $main
Draw-Icon 128 16 $main
Get-ChildItem $outDir | Select-Object Name, Length
