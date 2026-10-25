param([switch]$NoBrowser, [int]$Port = 8766)
$ErrorActionPreference = 'Stop'
$gameRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$gamePort = $Port
$gameUrl = "http://127.0.0.1:$gamePort/"
$gameNode = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $gameNode)) {
    $gameNode = (Get-Command node -ErrorAction Stop).Source
}
$gameReady = $false
try { $gameReady = (Invoke-WebRequest -Uri $gameUrl -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch {}
if (-not $gameReady) {
    $gameServer = Join-Path $gameRoot 'scripts\serve.mjs'
    Start-Process -FilePath $gameNode -ArgumentList @('"' + $gameServer + '"','--port',"$gamePort") -WorkingDirectory $gameRoot -WindowStyle Hidden
    for ($gameTry = 0; $gameTry -lt 20; $gameTry++) {
        Start-Sleep -Milliseconds 200
        try { if ((Invoke-WebRequest -Uri $gameUrl -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200) { $gameReady = $true; break } } catch {}
    }
}
if (-not $gameReady) { throw '本地服务器未能启动，请在终端运行 node scripts/serve.mjs' }
if (-not $NoBrowser) { Start-Process $gameUrl }
Write-Output "游戏已就绪：$gameUrl"
