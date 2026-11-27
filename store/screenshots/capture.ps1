# Captures the Chrome Web Store screenshots (1280x800 PNG) into this folder with
# headless Chrome (or Edge). The scenes run the real extension code on a sample
# article through test/preview.html and test/chrome-stub.js.
#
# Serve the project folder first, then run from the project folder:
#   python -m http.server 8000
#   .\store\screenshots\capture.ps1
param([string]$BaseUrl = 'http://localhost:8000')
$ErrorActionPreference = 'Stop'

$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Chrome or Edge was not found.' }

try {
  Invoke-WebRequest "$BaseUrl/manifest.json" -UseBasicParsing | Out-Null
} catch {
  throw "Nothing is serving the project at $BaseUrl. Run 'python -m http.server 8000' in the project folder first."
}

$article = 'store/screenshots/article.html?stub&scene='
$library = '../store/screenshots/sample-library.json'
$inPreview = [uri]::EscapeDataString("../${article}marks") # article as the page beside the library
$shots = [ordered]@{
  '1-highlight.png'  = "${article}toolbar"
  '2-side-panel.png' = "test/preview.html?ui=panel&side=right&seed=$library&page=$inPreview"
  '3-bookmark.png'   = "test/preview.html?ui=popup&float&page=$inPreview"
  '4-to-learn.png'   = "test/preview.html?ui=tab&page=none&seed=$library&view=learn"
  '5-backup.png'     = "test/preview.html?ui=tab&page=none&seed=$library&menu"
}

foreach ($name in $shots.Keys) {
  $out = Join-Path $PSScriptRoot $name
  $profileDir = Join-Path ([IO.Path]::GetTempPath()) ('hl-screenshot-' + [guid]::NewGuid())
  $arguments = @(
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--force-device-scale-factor=1', '--window-size=1280,800', '--virtual-time-budget=15000',
    "--user-data-dir=`"$profileDir`"", "--screenshot=`"$out`"", "`"$BaseUrl/$($shots[$name])`""
  )
  Start-Process -FilePath $browser -ArgumentList $arguments -Wait -NoNewWindow -RedirectStandardError (Join-Path $env:TEMP 'hl-screenshot.log')
  Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $out) { "Saved $name" } else { Write-Warning "No screenshot for $name" }
}
