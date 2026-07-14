# Claude & Codex Usage Battery — Windows 설치 스크립트
# 자체 완결 Go 트레이 앱(.exe)을 빌드/배치하고 시작프로그램에 등록한다.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "🔋 Claude & Codex Usage Battery (Windows) — 설치"
Write-Host "────────────────────────────────────"

$dest = Join-Path $env:LOCALAPPDATA "ClaudeCodexBattery"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$exe = Join-Path $dest "ccb-battery.exe"

# 1) exe 확보: 미리 빌드된 게 있으면 사용, 없으면 Go로 빌드 (bun 불필요 — 자체 완결)
$prebuilt = Join-Path $here "ccb-battery.exe"
if (Test-Path $prebuilt) {
  Copy-Item $prebuilt $exe -Force
  Write-Host "✅ 미리 빌드된 exe 사용"
}
elseif (Get-Command go -ErrorAction SilentlyContinue) {
  Write-Host "ⓘ  Go로 빌드 중..."
  $env:CGO_ENABLED = "0"
  go build -ldflags "-H windowsgui" -o $exe .
  Write-Host "✅ 빌드 완료"
}
else {
  Write-Host "❌ ccb-battery.exe도 없고 Go도 없습니다."
  Write-Host "   Go(https://go.dev/dl/) 설치 후 다시 실행하거나,"
  Write-Host "   릴리스에서 ccb-battery.exe를 받아 이 폴더(windows\)에 두고 다시 실행하세요."
  exit 1
}

# 2) 시작프로그램 등록 (로그인 시 자동 실행)
$run = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $run -Name "ClaudeCodexBattery" -Value "`"$exe`""
Write-Host "✅ 시작프로그램 등록 (로그인 시 자동 실행)"

# 3) 지금 실행 (이미 떠 있으면 재시작)
Get-Process ccb-battery -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process $exe
Write-Host "────────────────────────────────────"
Write-Host "✅ 완료! 시스템 트레이(작업표시줄 오른쪽)에 배터리가 뜹니다."
Write-Host "   안 보이면 트레이 오버플로(^) 안에서 끌어내 고정하세요."
Write-Host "   ※ Claude 배터리는 이 PC에 Claude Code 로그인(~/.claude/.credentials.json)이 있어야 표시됩니다."
