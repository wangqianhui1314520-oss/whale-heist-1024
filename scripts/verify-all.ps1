$ErrorActionPreference = 'Stop'
$gameRoot = Split-Path -Parent $PSScriptRoot
$gameOutput = Join-Path $gameRoot 'output\qa-2026-10-25'
$null = New-Item -ItemType Directory -Path $gameOutput -Force
$gameScripts = Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object {
    $_.Name -match '^(verify-|fuzz-).*\.mjs$' -and $_.Name -ne 'verify-build.mjs'
} | Sort-Object Name | ForEach-Object { 'scripts/' + $_.Name }
$gameChecks = @('src/core/verify-core.mjs') + @($gameScripts) + @('scripts/build-game.mjs', 'scripts/verify-build.mjs')
$gameResults = @()
Push-Location -LiteralPath $gameRoot
try {
    foreach ($gameCheck in $gameChecks) {
        $gameWatch = [System.Diagnostics.Stopwatch]::StartNew()
        $gameLogName = [System.IO.Path]::GetFileNameWithoutExtension($gameCheck) + '.txt'
        $gameLog = Join-Path $gameOutput $gameLogName
        & node $gameCheck 2>&1 | Out-File -LiteralPath $gameLog -Encoding utf8
        $gameExit = $LASTEXITCODE
        $gameWatch.Stop()
        $gamePassed = $gameExit -eq 0
        $gameResults += [PSCustomObject]@{ script=$gameCheck; passed=$gamePassed; durationMs=$gameWatch.ElapsedMilliseconds; exitCode=$gameExit; log=('output/qa-2026-10-25/' + $gameLogName) }
        Write-Output ((@('FAIL','PASS')[[int]$gamePassed]) + ' ' + $gameCheck + ' (' + $gameWatch.ElapsedMilliseconds + ' ms)')
        if (-not $gamePassed) { Get-Content -LiteralPath $gameLog }
    }
} finally { Pop-Location }
$gameReport = [PSCustomObject]@{ executedAt=[DateTime]::UtcNow.ToString('o'); total=$gameResults.Count; passed=@($gameResults | Where-Object passed).Count; failed=@($gameResults | Where-Object { -not $_.passed }).Count; results=$gameResults }
$gameReport | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $gameOutput 'summary.json') -Encoding utf8
Write-Output ($gameReport | Select-Object total,passed,failed | ConvertTo-Json -Compress)
if ($gameReport.failed -gt 0) { exit 1 }
