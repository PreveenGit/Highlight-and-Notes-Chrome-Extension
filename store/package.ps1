# Builds the Chrome Web Store upload: dist/highlight-<version>.zip containing only
# the files the extension needs (no test/, store/, docs/ or git files).
#
#   .\store\package.ps1        (from the project folder, in PowerShell)
#
# Uses .NET directly because Windows PowerShell's Compress-Archive writes
# backslashes into zip paths, which other tools (and the store) can misread.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path $PSScriptRoot -Parent
$include = @('manifest.json', 'background.js', 'shared', 'content', 'popup', 'library', 'icons')
$manifestText = [System.IO.File]::ReadAllText((Join-Path $root 'manifest.json'))
$manifest = $manifestText | ConvertFrom-Json

# "key" only pins the ID of the unpacked copy loaded from this folder. The Web Store
# gives the item its own ID, so the uploaded manifest leaves the key out.
$storeManifest = $manifestText -replace '(?m)^[ \t]*"key"[ \t]*:[ \t]*"[^"]*",[ \t]*\r?\n', ''
if (($storeManifest | ConvertFrom-Json).PSObject.Properties.Name -contains 'key') {
  throw 'Could not remove "key" from manifest.json for the store upload.'
}

# Collect files as zip entry names ("content/main.js").
$entries = [ordered]@{}
foreach ($item in $include) {
  $path = Join-Path $root $item
  $files = if (Test-Path $path -PathType Container) { Get-ChildItem $path -Recurse -File } else { Get-Item $path }
  foreach ($file in $files) {
    $entries[$file.FullName.Substring($root.Length + 1).Replace('\', '/')] = $file.FullName
  }
}

# Every file the manifest points at must be in the zip.
$referenced = @($manifest.background.service_worker, $manifest.action.default_popup, $manifest.side_panel.default_path)
$referenced += $manifest.icons.PSObject.Properties.Value
$referenced += $manifest.action.default_icon.PSObject.Properties.Value
foreach ($script in $manifest.content_scripts) { $referenced += $script.js + $script.css }
$missing = $referenced | Where-Object { $_ -and -not $entries.Contains($_) }
if ($missing) { throw "Files referenced in manifest.json are missing: $($missing -join ', ')" }

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zipPath = Join-Path $dist "highlight-$($manifest.version).zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }

$stream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
$zip = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($name in $entries.Keys) {
    if ($name -eq 'manifest.json') {
      $entry = $zip.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
      $writer = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
      try { $writer.Write($storeManifest) } finally { $writer.Dispose() }
    } else {
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $entries[$name], $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  }
} finally {
  $zip.Dispose()
  $stream.Dispose()
}

$size = [Math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Output "Built $zipPath ($($entries.Count) files, $size KB) for version $($manifest.version)"
$entries.Keys | ForEach-Object { "  $_" }
