# Downloads the prebuilt UxPlay receiver for Windows (third-party build by leapbtw)
# into vendor/uxplay. Run with: npm run setup
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $root 'vendor\uxplay'

if (Test-Path (Join-Path $dest 'uxplay-windows.exe')) {
  Write-Host 'Receiver already installed in vendor\uxplay'
  return
}

$release = Invoke-RestMethod 'https://api.github.com/repos/leapbtw/uxplay-windows/releases/latest'
$asset = $release.assets | Where-Object name -eq 'uxplay-windows.zip'
if (-not $asset) { throw 'uxplay-windows.zip not found in the latest release' }

$zip = Join-Path ([IO.Path]::GetTempPath()) 'uxplay-windows.zip'
Write-Host ("Downloading {0} ({1} MB)..." -f $release.tag_name, [math]::Round($asset.size / 1MB))
Invoke-WebRequest $asset.browser_download_url -OutFile $zip

New-Item -ItemType Directory -Force $dest | Out-Null
Expand-Archive $zip $dest -Force
Remove-Item $zip
Write-Host 'Done. Start the app with: npm start'
