package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"fyne.io/systray"
)

const version = "1.5.0"
const repoURL = "https://github.com/jason191188/claude-codex-battery"

var (
	miItems   []*systray.MenuItem // 배터리 상세 행 (최대 5)
	miMode    *systray.MenuItem
	miRefresh *systray.MenuItem
	miRepo    *systray.MenuItem
	miQuit    *systray.MenuItem
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--dump" {
		dump() // 헤드리스 검증용: gather() + 아이콘 미리보기
		return
	}
	systray.Run(onReady, func() {})
}

func onReady() {
	systray.SetTitle("")
	systray.SetTooltip("Claude & Codex Usage")

	for i := 0; i < 5; i++ {
		mi := systray.AddMenuItem("", "")
		mi.Disable() // 정보 표시용, 클릭 동작 없음
		mi.Hide()
		miItems = append(miItems, mi)
	}
	systray.AddSeparator()
	miMode = systray.AddMenuItem("", "배터리 표시 전환")
	miRefresh = systray.AddMenuItem("🔄 지금 새로고침", "")
	miRepo = systray.AddMenuItem("⭐ GitHub 저장소 열기", "")
	systray.AddSeparator()
	miQuit = systray.AddMenuItem("종료", "")

	go eventLoop()
	go pollLoop()
}

func pollLoop() {
	refresh()
	t := time.NewTicker(2 * time.Minute)
	defer t.Stop()
	for range t.C {
		refresh()
	}
}

func eventLoop() {
	for {
		select {
		case <-miRefresh.ClickedCh:
			refresh()
		case <-miMode.ClickedCh:
			toggleMode()
			refresh()
		case <-miRepo.ClickedCh:
			openURL(repoURL)
		case <-miQuit.ClickedCh:
			systray.Quit()
			return
		}
	}
}

func refresh() {
	snap := gather()
	dark := isDarkMode()

	// 트레이 아이콘 = 현재 5시간 배터리 (C5 우선, 없으면 X5/X, 그것도 없으면 첫 배터리)
	icon := pickIconBattery(snap.Batteries)
	if icon != nil {
		systray.SetIcon(iconBytes(drawBattery(icon.Remain, dark)))
		systray.SetTooltip(tooltip(snap))
	} else {
		systray.SetIcon(iconBytes(drawBattery(-1, dark)))
		systray.SetTooltip("데이터 없음 — Claude Code / Codex 실행 필요")
	}

	// 메뉴 상세: 모드에 따라 전체(5개) 또는 현재 5시간만
	mode := readMode()
	shown := snap.Batteries
	if mode == "5h" {
		var f []Battery
		for _, b := range snap.Batteries {
			if b.Label == "C5" || b.Label == "X5" || b.Label == "X" {
				f = append(f, b)
			}
		}
		shown = f
	}
	for i, mi := range miItems {
		if i < len(shown) {
			b := shown[i]
			r := "—"
			if b.Remain >= 0 {
				r = fmt.Sprintf("%d%%", b.Remain)
			}
			mi.SetTitle(fmt.Sprintf("%s  %s   %s", b.Label, r, b.Detail))
			mi.Show()
		} else {
			mi.Hide()
		}
	}
	if mode == "5h" {
		miMode.SetTitle("🔋 표시: 현재 5시간만 → 클릭 시 전체")
	} else {
		miMode.SetTitle("🔋 표시: 전체 → 클릭 시 현재 5시간만")
	}
}

func pickIconBattery(bs []Battery) *Battery {
	for _, want := range []string{"C5", "X5", "X"} {
		for i := range bs {
			if bs[i].Label == want {
				return &bs[i]
			}
		}
	}
	if len(bs) > 0 {
		return &bs[0]
	}
	return nil
}

func tooltip(s Snapshot) string {
	var parts []string
	for _, b := range s.Batteries {
		r := "—"
		if b.Remain >= 0 {
			r = fmt.Sprintf("%d%%", b.Remain)
		}
		parts = append(parts, b.Label+" "+r)
	}
	return strings.Join(parts, " · ")
}

// ── 표시 모드 (.batt-mode, mac 버전과 공유 규칙) ──
func readMode() string {
	b, err := os.ReadFile(filepath.Join(stateDir(), ".batt-mode"))
	if err == nil && strings.TrimSpace(string(b)) == "5h" {
		return "5h"
	}
	return "all"
}

func toggleMode() {
	nm := "5h"
	if readMode() == "5h" {
		nm = "all"
	}
	os.MkdirAll(stateDir(), 0o755)
	os.WriteFile(filepath.Join(stateDir(), ".batt-mode"), []byte(nm), 0o644)
}

// ── OS 헬퍼 ──
func isDarkMode() bool {
	if runtime.GOOS == "windows" {
		out, err := exec.Command("reg", "query",
			`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`,
			"/v", "AppsUseLightTheme").Output()
		if err != nil {
			return true // 기본 다크
		}
		// AppsUseLightTheme 0x1 = 라이트, 0x0 = 다크
		return !strings.Contains(string(out), "0x1")
	}
	out, _ := exec.Command("defaults", "read", "-g", "AppleInterfaceStyle").Output()
	return strings.Contains(string(out), "Dark")
}

func openURL(u string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
	case "darwin":
		exec.Command("open", u).Start()
	default:
		exec.Command("xdg-open", u).Start()
	}
}
