package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ── 잔량 % → 색 (5단계, mac SwiftBar 버전과 동일) ──
type rgba struct{ R, G, B uint8 }

func heatColor(remain int) rgba {
	switch {
	case remain <= 20:
		return rgba{255, 69, 58} // red
	case remain <= 40:
		return rgba{255, 159, 10} // orange
	case remain <= 60:
		return rgba{255, 214, 10} // yellow
	case remain <= 80:
		return rgba{168, 219, 66} // lime
	default:
		return rgba{48, 209, 88} // green
	}
}

type Battery struct {
	Label  string // C5 CW CF X5 XW X
	Group  string // C or X
	Remain int    // 0..100, -1 = 알 수 없음
	Detail string // 메뉴용: "5시간 · 리셋 3h 12m"
}

type Snapshot struct {
	Batteries []Battery
	HasClaude bool
	HasCodex  bool
}

func home() string {
	h, _ := os.UserHomeDir()
	return h
}

func stateDir() string { return filepath.Join(home(), ".claude", "swiftbar") }

func fmtDur(secs int64) string {
	if secs <= 0 {
		return "0m"
	}
	h := secs / 3600
	m := (secs % 3600) / 60
	if h >= 24 {
		return fmt.Sprintf("%dd %dh", h/24, h%24)
	}
	if h > 0 {
		return fmt.Sprintf("%dh %dm", h, m)
	}
	return fmt.Sprintf("%dm", m)
}

func isoToEpoch(s string) int64 {
	if s == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return 0
	}
	return t.Unix()
}

// ── Claude: Anthropic OAuth usage API 직접 조회 (Windows는 파일 자격증명) ──
type claudeWindow struct {
	Utilization float64 `json:"utilization"`
	ResetsAt    string  `json:"resets_at"`
}
type claudeUsage struct {
	FiveHour *claudeWindow `json:"five_hour"`
	SevenDay *claudeWindow `json:"seven_day"`
	Limits   []struct {
		Group    string  `json:"group"`
		Percent  float64 `json:"percent"`
		ResetsAt string  `json:"resets_at"`
		Scope    struct {
			Model struct {
				DisplayName string `json:"display_name"`
			} `json:"model"`
		} `json:"scope"`
	} `json:"limits"`
}

func readClaudeToken() string {
	b, err := os.ReadFile(filepath.Join(home(), ".claude", ".credentials.json"))
	if err != nil {
		return ""
	}
	var c struct {
		ClaudeAiOauth struct {
			AccessToken string `json:"accessToken"`
		} `json:"claudeAiOauth"`
	}
	if json.Unmarshal(b, &c) != nil {
		return ""
	}
	return c.ClaudeAiOauth.AccessToken
}

func claudeCachePath() string { return filepath.Join(stateDir(), ".claude-usage.json") }

func readClaudeCache() *claudeUsage {
	b, err := os.ReadFile(claudeCachePath())
	if err != nil {
		return nil
	}
	var u claudeUsage
	if json.Unmarshal(b, &u) == nil && u.FiveHour != nil {
		return &u
	}
	var wrap struct {
		Data claudeUsage `json:"data"`
	}
	if json.Unmarshal(b, &wrap) == nil && wrap.Data.FiveHour != nil {
		return &wrap.Data
	}
	return nil
}

func fetchClaudeUsage() *claudeUsage {
	// 옵트아웃: ~/.claude/swiftbar/.no-live 있으면 캐시만 사용
	if _, err := os.Stat(filepath.Join(stateDir(), ".no-live")); err == nil {
		return readClaudeCache()
	}
	token := readClaudeToken()
	if token == "" {
		return readClaudeCache()
	}
	req, err := http.NewRequest("GET", "https://api.anthropic.com/api/oauth/usage", nil)
	if err != nil {
		return readClaudeCache()
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	resp, err := (&http.Client{Timeout: 8 * time.Second}).Do(req)
	if err != nil {
		return readClaudeCache()
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return readClaudeCache()
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return readClaudeCache()
	}
	var u claudeUsage
	if json.Unmarshal(body, &u) != nil || u.FiveHour == nil {
		return readClaudeCache()
	}
	os.MkdirAll(stateDir(), 0o755)
	os.WriteFile(claudeCachePath(), body, 0o644)
	return &u
}

// ── Codex: 가장 신선한 세션의 rate_limits ──
type codexWindow struct {
	UsedPercent float64 `json:"used_percent"`
	ResetsAt    int64   `json:"resets_at"`
}
type codexRL struct {
	PlanType  string       `json:"plan_type"`
	LimitID   string       `json:"limit_id"`
	Primary   *codexWindow `json:"primary"`
	Secondary *codexWindow `json:"secondary"`
	Credits   *struct {
		Unlimited  bool    `json:"unlimited"`
		HasCredits bool    `json:"has_credits"`
		Balance    float64 `json:"balance"`
	} `json:"credits"`
}

func fetchCodex() *codexRL {
	root := filepath.Join(home(), ".codex", "sessions")
	type fi struct {
		path  string
		mtime time.Time
	}
	var files []fi
	filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() && strings.HasSuffix(p, ".jsonl") {
			if info, e := d.Info(); e == nil {
				files = append(files, fi{p, info.ModTime()})
			}
		}
		return nil
	})
	sort.Slice(files, func(i, j int) bool { return files[i].mtime.After(files[j].mtime) })
	for i, f := range files {
		if i >= 8 {
			break
		}
		b, err := os.ReadFile(f.path)
		if err != nil {
			continue
		}
		lines := strings.Split(strings.TrimSpace(string(b)), "\n")
		for j := len(lines) - 1; j >= 0; j-- {
			if !strings.Contains(lines[j], "rate_limits") {
				continue
			}
			var obj struct {
				Payload *struct {
					RateLimits *codexRL `json:"rate_limits"`
				} `json:"payload"`
				RateLimits *codexRL `json:"rate_limits"`
			}
			if json.Unmarshal([]byte(lines[j]), &obj) != nil {
				continue
			}
			rl := obj.RateLimits
			if obj.Payload != nil && obj.Payload.RateLimits != nil {
				rl = obj.Payload.RateLimits
			}
			if rl != nil && (rl.Primary != nil || rl.Secondary != nil || rl.Credits != nil) {
				return rl
			}
		}
	}
	return nil
}

// ── 배터리 목록 계산 (mac 버전과 동일 로직) ──
func gather() Snapshot {
	now := time.Now().Unix()
	var s Snapshot

	if cu := fetchClaudeUsage(); cu != nil && cu.FiveHour != nil {
		s.HasClaude = true
		add := func(label string, pct float64, reset int64, extra string) {
			remain := 100 - int(pct+0.5)
			if remain < 0 {
				remain = 0
			}
			detail := extra
			if reset > now {
				detail += " · 리셋 " + fmtDur(reset-now)
			}
			s.Batteries = append(s.Batteries, Battery{label, "C", remain, detail})
		}
		add("C5", cu.FiveHour.Utilization, isoToEpoch(cu.FiveHour.ResetsAt), "5시간")
		if cu.SevenDay != nil {
			add("CW", cu.SevenDay.Utilization, isoToEpoch(cu.SevenDay.ResetsAt), "주간")
		}
		for _, l := range cu.Limits {
			if l.Group == "weekly" && l.Scope.Model.DisplayName != "" {
				add("CF", l.Percent, isoToEpoch(l.ResetsAt), l.Scope.Model.DisplayName)
				break
			}
		}
	}

	if cx := fetchCodex(); cx != nil {
		s.HasCodex = true
		if cx.Primary != nil || cx.Secondary != nil {
			addC := func(label string, w *codexWindow, extra string) {
				if w == nil {
					s.Batteries = append(s.Batteries, Battery{label, "X", -1, extra})
					return
				}
				pct := w.UsedPercent
				if w.ResetsAt > 0 && w.ResetsAt < now {
					pct = 0 // stale → 리셋된 것으로 간주
				}
				remain := 100 - int(pct+0.5)
				if remain < 0 {
					remain = 0
				}
				detail := extra
				if w.ResetsAt > now {
					detail += " · 리셋 " + fmtDur(w.ResetsAt-now)
				}
				s.Batteries = append(s.Batteries, Battery{label, "X", remain, detail})
			}
			addC("X5", cx.Primary, "5시간")
			addC("XW", cx.Secondary, "주간")
		} else if cx.Credits != nil {
			remain := 0
			if cx.Credits.Unlimited || (cx.Credits.HasCredits && cx.Credits.Balance > 0) {
				remain = 100
			}
			s.Batteries = append(s.Batteries, Battery{"X", "X", remain, "크레딧"})
		}
	}
	return s
}
