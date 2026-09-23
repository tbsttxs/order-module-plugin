$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot
$version = '0.1.0-pilot'
$dist = Join-Path $project 'dist'
$stage = Join-Path $dist "order-module-$version"
$zip = Join-Path $dist "order-module-$version.zip"
$node = (Get-Command node -ErrorAction Stop).Source

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
if (Test-Path $zip) { Remove-Item -Force $zip }
New-Item -ItemType Directory -Force -Path $stage, (Join-Path $stage 'runtime') | Out-Null

$rootFiles = @('package.json', 'README.md', 'server.mjs')
foreach ($name in $rootFiles) { Copy-Item (Join-Path $project $name) $stage }
$template = Get-ChildItem $project -Filter '*.xlsx' | Select-Object -First 1
if ($template) { Copy-Item $template.FullName (Join-Path $stage 'task-template.xlsx') }
Copy-Item (Join-Path $PSScriptRoot 'manifest.json') $stage
Copy-Item (Join-Path $PSScriptRoot 'start-pilot.cmd') (Join-Path $stage 'start-workbench.cmd')
Copy-Item (Join-Path $PSScriptRoot 'stop-pilot.cmd') (Join-Path $stage 'stop-workbench.cmd')
$releaseDocs = Get-ChildItem $PSScriptRoot -Filter '*.md' | Sort-Object Name
foreach ($doc in $releaseDocs) { Copy-Item $doc.FullName (Join-Path $stage ("TEAM-DOC-" + $doc.Name.GetHashCode() + '.md')) }
Copy-Item $node (Join-Path $stage 'runtime\node.exe')

Copy-Item -Recurse (Join-Path $project 'public') $stage
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'apps') | Out-Null

$legacySource = Join-Path $project 'apps\legacy-order'
$legacyTarget = Join-Path $stage 'apps\legacy-order'
New-Item -ItemType Directory -Force -Path $legacyTarget | Out-Null
$legacyItems = @(
  'lib', 'node_modules', 'public', 'test', 'package.json', 'package-lock.json',
  'runner.mjs', 'server.mjs', 'watchdog.mjs'
)
foreach ($name in $legacyItems) {
  $source = Join-Path $legacySource $name
  if (Test-Path $source) { Copy-Item -Recurse $source $legacyTarget }
}

$freshSource = Join-Path $project 'apps\new-order'
$freshTarget = Join-Path $stage 'apps\new-order'
New-Item -ItemType Directory -Force -Path $freshTarget | Out-Null
$freshItems = @(
  'public', 'package.json', 'server.mjs', 'purchase-login.mjs',
  'new-product-runner.mjs'
)
foreach ($name in $freshItems) {
  $source = Join-Path $freshSource $name
  if (Test-Path $source) { Copy-Item -Recurse $source $freshTarget }
}

New-Item -ItemType Directory -Force -Path (Join-Path $stage 'apps\legacy-order\runs'), (Join-Path $stage 'apps\legacy-order\uploads'), (Join-Path $stage 'apps\new-order\results') | Out-Null

$forbidden = @('.git', 'config.json', 'settings.json', 'state.json', 'progress.json', 'credentials.json')
foreach ($name in $forbidden) {
  if (Get-ChildItem -Path $stage -Recurse -Force -Filter $name -ErrorAction SilentlyContinue) {
    throw "发布包包含禁止文件：$name"
  }
}

Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash -Algorithm SHA256 $zip).Hash
$size = (Get-Item $zip).Length
[pscustomobject]@{ Version=$version; Stage=$stage; Zip=$zip; SHA256=$hash; Bytes=$size } | ConvertTo-Json
