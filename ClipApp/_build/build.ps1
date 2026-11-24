# Builds ClipApp.exe (launcher) and ClipApp_Setup.exe (self-contained installer with the app inside).
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$b = $PSScriptRoot
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$fw = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
& "$root\runtime\python\python.exe" "$b\make_icon.py" "$root\ClipApp.ico"
& $csc /nologo /target:winexe /optimize "/win32icon:$root\ClipApp.ico" "/out:$root\ClipApp.exe" /r:System.Windows.Forms.dll "$b\Launcher.cs"
if ($LASTEXITCODE) { throw "launcher build failed" }

$stage = "$b\payload"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force "$stage\app\ui", "$stage\banners", "$stage\config" | Out-Null
Copy-Item "$root\app\*.py" "$stage\app" -Exclude selftest.py
Copy-Item "$root\app\ui\*" "$stage\app\ui"
Copy-Item "$root\banners\*" "$stage\banners"
Copy-Item "$root\ClipApp.exe", "$root\ClipApp.ico", "$root\Как пользоваться.txt" $stage
Set-Content "$stage\config\claude_api_key.txt" "# Вставь сюда свой ключ Claude API (sk-ant-...) отдельной строкой и сохрани файл. Необязательно." -Encoding UTF8
$zip = "$b\payload.zip"
if (Test-Path $zip) { Remove-Item $zip }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false, [Text.Encoding]::UTF8)
Remove-Item $stage -Recurse -Force

& $csc /nologo /target:winexe /optimize "/win32icon:$root\ClipApp.ico" "/out:$root\ClipApp_Setup.exe" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll "/r:$fw\System.IO.Compression.dll" "/r:$fw\System.IO.Compression.FileSystem.dll" `
  "/resource:$zip,payload.zip" "$b\Setup.cs"
if ($LASTEXITCODE) { throw "setup build failed" }
Remove-Item $zip
Get-Item "$root\ClipApp.exe", "$root\ClipApp_Setup.exe" | Select-Object Name, Length
