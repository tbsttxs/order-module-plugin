$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $env:LOCALAPPDATA '老品下单工作台'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Get-ChildItem -Force $source | Where-Object { $_.Name -notin @('runs','uploads','config.json','settings.json','progress.json','pause-*.flag') } | ForEach-Object {
  Copy-Item -Force -Recurse $_.FullName $target
}
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = Join-Path $desktop '老品下单工作台.lnk'
$ws = New-Object -ComObject WScript.Shell
$link = $ws.CreateShortcut($shortcut)
$link.TargetPath = Join-Path $target '一键启动工作台.cmd'
$link.WorkingDirectory = $target
$link.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
$link.Description = '启动老品下单工作台'
$link.Save()
Start-Process (Join-Path $target '一键启动工作台.cmd')
Write-Host "安装完成：$target"
Write-Host '桌面已创建“老品下单工作台”快捷方式。'
