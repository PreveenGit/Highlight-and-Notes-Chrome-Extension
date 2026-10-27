# Draws the extension icons into icons/.
# 16/32/48 fill the whole square so they stay legible in the toolbar. 128 is also
# the Chrome Web Store icon, which should be 96x96 artwork with 16 px of
# transparent padding on each side.
Add-Type -AssemblyName System.Drawing
$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

function Draw-Icon([int]$size, [int]$pad) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  # Rounded yellow square
  $art = $size - 2 * $pad
  $r = [Math]::Max(3, [int]($art * 0.22))
  $x = $pad
  $w = $art - 1
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($x, $x, $r * 2, $r * 2, 180, 90)
  $path.AddArc($x + $w - $r * 2, $x, $r * 2, $r * 2, 270, 90)
  $path.AddArc($x + $w - $r * 2, $x + $w - $r * 2, $r * 2, $r * 2, 0, 90)
  $path.AddArc($x, $x + $w - $r * 2, $r * 2, $r * 2, 90, 90)
  $path.CloseFigure()
  $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 214, 0))
  $g.FillPath($fill, $path)

  # Dark "H" in the middle
  $font = New-Object System.Drawing.Font 'Segoe UI', ([float]($art * 0.62)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 33, 33, 33))
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF $x, ([float]($x + $art * 0.03)), $art, $art
  $g.DrawString('H', $font, $ink, $rect, $fmt)

  $bmp.Save((Join-Path $outDir "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

Draw-Icon 16 0
Draw-Icon 32 0
Draw-Icon 48 0
Draw-Icon 128 16
Get-ChildItem $outDir | Select-Object Name, Length
