#!/bin/bash
# Claude & Codex 사용량 배터리 위젯 — 설치 스크립트
set -e
cd "$(dirname "$0")"

echo "🔋 Claude & Codex Usage Battery — 설치"
echo "────────────────────────────────────"

# 사용자 확인 (TTY가 아니면 — curl | bash 등 — 자동 진행)
ask() {
  [ -t 0 ] || return 0
  read -r -p "$1 [Y/n] " a
  case "$a" in n | N | no | NO) return 1 ;; *) return 0 ;; esac
}

# 1) bun (필수 — 없으면 공식 스크립트로 설치 제안)
if ! command -v bun >/dev/null 2>&1 && [ ! -x "$HOME/.bun/bin/bun" ]; then
  echo "ⓘ  bun이 없습니다."
  if ask "   지금 설치할까요? (curl -fsSL https://bun.sh/install | bash)"; then
    curl -fsSL https://bun.sh/install | bash
  else
    echo "❌ bun 없이는 진행할 수 없습니다. 직접 설치 후 다시 실행하세요."
    exit 1
  fi
fi
# 방금 설치한 경우 현재 셸 PATH에 없을 수 있음 → ~/.bun/bin 폴백
BUN=$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")
if [ ! -x "$BUN" ]; then
  echo "❌ bun 설치를 확인하지 못했습니다. 새 터미널에서 다시 실행해 보세요."
  exit 1
fi
echo "✅ bun: $BUN"

# 2) SwiftBar (필수 — 없으면 brew 또는 GitHub 릴리스로 설치 제안)
if [ ! -d "/Applications/SwiftBar.app" ]; then
  echo "ⓘ  SwiftBar가 없습니다."
  if command -v brew >/dev/null 2>&1; then
    if ask "   Homebrew로 지금 설치할까요? (brew install --cask swiftbar)"; then
      brew install --cask swiftbar
    else
      echo "❌ SwiftBar 없이는 진행할 수 없습니다."
      exit 1
    fi
  else
    if ask "   GitHub 최신 릴리스를 받아 /Applications에 설치할까요?"; then
      ZIP_URL=$(curl -fsSL --max-time 15 https://api.github.com/repos/swiftbar/SwiftBar/releases/latest |
        grep -oE '"browser_download_url": *"[^"]+\.zip"' | grep -oE 'https://[^"]+' | head -1)
      if [ -z "$ZIP_URL" ]; then
        echo "❌ 릴리스 주소를 찾지 못했습니다. 직접 설치하세요: https://github.com/swiftbar/SwiftBar/releases"
        exit 1
      fi
      TMPD=$(mktemp -d)
      curl -fL --max-time 120 -o "$TMPD/SwiftBar.zip" "$ZIP_URL"
      unzip -q "$TMPD/SwiftBar.zip" -d "$TMPD"
      mv "$TMPD/SwiftBar.app" /Applications/
      rm -rf "$TMPD"
      echo "   (첫 실행 시 macOS가 '인터넷에서 받은 앱' 확인 창을 띄울 수 있습니다 — 열기를 누르세요)"
    else
      echo "❌ SwiftBar 없이는 진행할 수 없습니다."
      exit 1
    fi
  fi
  if [ ! -d "/Applications/SwiftBar.app" ]; then
    echo "❌ SwiftBar 설치에 실패했습니다."
    exit 1
  fi
fi
echo "✅ SwiftBar"

# 3) ccusage (선택 — 없어도 배터리는 정상. 드롭다운의 비용/모델별 상세에만 사용)
if command -v ccusage >/dev/null 2>&1 || [ -x "$HOME/.bun/bin/ccusage" ]; then
  echo "✅ ccusage (드롭다운 비용 상세 표시됨)"
else
  echo "ⓘ  ccusage 없음 — 배터리 정상, 드롭다운 비용 상세만 생략 (원하면: bun add -g ccusage)"
fi

# 4) codex (선택 — 없으면 Codex 배터리는 안 뜨고 Claude만 표시)
if command -v codex >/dev/null 2>&1; then
  echo "✅ codex CLI (Codex 배터리 표시됨)"
else
  echo "ⓘ  codex CLI 없음 — Claude 배터리만 표시됩니다"
fi

# 5) 플러그인 배치 (shebang을 이 환경의 bun 절대경로로 — SwiftBar는 GUI라 PATH가 제한적)
PLUGIN_DIR="${SWIFTBAR_PLUGIN_DIR:-$HOME/.swiftbar-plugins}"
mkdir -p "$PLUGIN_DIR"
sed "1s|.*|#!$BUN|" claude-codex-usage.2m.js > "$PLUGIN_DIR/claude-codex-usage.2m.js"
chmod +x "$PLUGIN_DIR/claude-codex-usage.2m.js"
# self-update 스크립트를 dot 파일로 배치 (SwiftBar가 플러그인으로 오인 실행하지 않도록)
cp ccb-update.sh "$PLUGIN_DIR/.ccb-update.sh"
chmod +x "$PLUGIN_DIR/.ccb-update.sh"
echo "✅ 플러그인 배치: $PLUGIN_DIR"

# 6) SwiftBar에 폴더 지정 + 실행
BID=$(defaults read /Applications/SwiftBar.app/Contents/Info CFBundleIdentifier 2>/dev/null || echo "com.ameba.SwiftBar")
defaults write "$BID" PluginDirectory -string "$PLUGIN_DIR"
# 과거에 이 플러그인을 SwiftBar 메뉴에서 껐거나 .bak 오염 등으로 DisabledPlugins에 남아 있으면
# 파일이 멀쩡해도 메뉴바에 안 뜬다 → 재설치 시 비활성 목록에서 제거해 확실히 켠다.
if defaults read "$BID" DisabledPlugins 2>/dev/null | grep -q "claude-codex-usage.2m.js"; then
  REMAIN=$(defaults read "$BID" DisabledPlugins 2>/dev/null \
    | grep -oE '"[^"]+"' | tr -d '"' | grep -v "^claude-codex-usage.2m.js$" || true)
  defaults delete "$BID" DisabledPlugins 2>/dev/null || true
  if [ -n "$REMAIN" ]; then
    while IFS= read -r p; do [ -n "$p" ] && defaults write "$BID" DisabledPlugins -array-add "$p"; done <<< "$REMAIN"
  fi
  echo "ⓘ  플러그인이 SwiftBar 비활성 목록에 있어 자동으로 다시 켰습니다"
fi
# SwiftBar가 이미 실행 중이면 open만으론 새 폴더/활성화를 다시 안 읽으므로 완전 재시작
osascript -e 'tell application "SwiftBar" to quit' >/dev/null 2>&1 || true
sleep 1
open -a SwiftBar

# 7) 로그인 항목 등록 → 재부팅/재로그인 후에도 자동으로 다시 뜸
if osascript -e 'tell application "System Events" to get the name of every login item' 2>/dev/null | grep -qi swiftbar; then
  echo "✅ 로그인 항목에 이미 등록됨 (재부팅 후 자동 실행)"
else
  if osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/SwiftBar.app", hidden:false}' >/dev/null 2>&1; then
    echo "✅ 로그인 항목 등록 (재부팅 후 자동 실행)"
  else
    echo "ⓘ  로그인 항목 자동 등록 실패 — SwiftBar 메뉴에서 'Launch at Login'을 켜주세요"
  fi
fi

echo "────────────────────────────────────"
echo "✅ 완료! 메뉴바 오른쪽에 배터리가 뜹니다."
echo "   갱신 주기: 2분 (파일명 .2m. 을 .1m. .5m. 등으로 바꾸면 조정)"
echo "   재부팅 후에도 자동으로 다시 뜹니다."
