#!/usr/bin/env bun
// <xbar.title>Claude & Codex Usage</xbar.title>
// <xbar.version>v3.0</xbar.version>
// <xbar.author>개발부스러기</xbar.author>
// <xbar.desc>Claude Code 5시간 블록 + Codex rate limit을 메뉴바에 배터리 아이콘으로 상시 표시</xbar.desc>
// SwiftBar 플러그인: 2분마다 갱신. 메뉴바=네이티브 SF Symbol 배터리(벡터), 클릭=상세 게이지.

import { execSync, spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
// 바이너리 경로 자동 탐지 (환경별로 다름 — 이식성)
function findBin(name, extra = []) {
  const cands = [
    ...extra,
    `${HOME}/.bun/bin/${name}`,
    "/opt/homebrew/bin/" + name,
    "/usr/local/bin/" + name,
  ];
  for (const c of cands) {
    try {
      if (existsSync(c)) return c;
    } catch {}
  }
  try {
    const p = execSync(`command -v ${name} 2>/dev/null`, {
      encoding: "utf8",
    }).trim();
    if (p) return p;
  } catch {}
  return name; // 최후: PATH에 의존
}
const CCUSAGE = findBin("ccusage");
const CODEX_BIN = findBin("codex");
const CODEX_SESSIONS = `${HOME}/.codex/sessions`;
const now = Math.floor(Date.now() / 1000);

// ── 자동 업데이트 (알림 + 원클릭) ──
const VERSION = "1.5.0";
const SELF_DIR = dirname(process.argv[1] || `${HOME}/.swiftbar-plugins/x`);
const REPO_RAW =
  "https://raw.githubusercontent.com/jason191188/claude-codex-battery/main";
const UPDATE_CACHE = `${HOME}/.claude/swiftbar/.update-check.json`;
function cmpVer(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}
// 캐시된 최신 버전을 읽고, 24h+ 지났으면 백그라운드로 GitHub VERSION만 조용히 확인
// (렌더를 막지 않음 — codex 자동갱신과 동일한 spawn+unref 패턴)
function getUpdateInfo() {
  let cache = null;
  try {
    cache = JSON.parse(readFileSync(UPDATE_CACHE, "utf8"));
  } catch {}
  const age = cache?.checkedAt ? now - cache.checkedAt : Infinity;
  if (age > 24 * 3600) {
    try {
      const cmd =
        `latest=$(curl -fsL --max-time 8 "${REPO_RAW}/VERSION" 2>/dev/null | tr -d '[:space:]'); ` +
        `[ -n "$latest" ] && printf '{"checkedAt":%s,"latest":"%s"}' "${now}" "$latest" > "${UPDATE_CACHE}"`;
      const child = spawn("/bin/sh", ["-c", cmd], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch {}
  }
  const latest = cache?.latest;
  return { latest, hasUpdate: !!latest && cmpVer(latest, VERSION) > 0 };
}

// ── 크기 프리셋: big(기본) / small — 드롭다운 ↕ 행 또는 ~/.claude/swiftbar/.batt-size 로 전환 ──
const SIZE_FILE = `${HOME}/.claude/swiftbar/.batt-size`;
let SIZE = "big";
try {
  if (readFileSync(SIZE_FILE, "utf8").trim() === "small") SIZE = "small";
} catch {}
// ── 표시 모드: all(기본, 5개 전부) / 5h(현재 5시간 창만 C·X 2개) — 드롭다운 🔋 행으로 전환 ──
const MODE_FILE = `${HOME}/.claude/swiftbar/.batt-mode`;
let MODE = "all";
try {
  if (readFileSync(MODE_FILE, "utf8").trim() === "5h") MODE = "5h";
} catch {}

// 잔량 % → 색 (5단계: 빨강→주황→노랑→라임→초록). 메뉴바 SF 배터리 틴트 + 드롭다운 게이지 공용.
const heatRemainHex = (r) =>
  r <= 20
    ? "#FF453A"
    : r <= 40
      ? "#FF9F0A"
      : r <= 60
        ? "#FFD60A"
        : r <= 80
          ? "#A8DB42"
          : "#30D158";
function isDarkMode() {
  try {
    return (
      execSync("defaults read -g AppleInterfaceStyle 2>/dev/null", {
        encoding: "utf8",
        timeout: 3000,
      }).trim() === "Dark"
    );
  } catch {
    return false;
  }
}

// ── 게이지 렌더 (부분 블록, 의존성 0) ──────────────────────
const FULL = "█",
  EMPTY = "░",
  PART = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
function bar(pct, w) {
  pct = Math.max(0, Math.min(100, pct || 0));
  const filled = (pct / 100) * w;
  let fb = Math.floor(filled);
  let idx = Math.round((filled - fb) * 8);
  if (idx === 8) {
    fb++;
    idx = 0;
  }
  fb = Math.min(fb, w);
  let s = FULL.repeat(fb),
    used = fb;
  if (idx > 0 && fb < w) {
    s += PART[idx];
    used++;
  }
  s += EMPTY.repeat(Math.max(0, w - used));
  return s;
}

// ── 공용 유틸 ──────────────────────────────────────────────
const fmtDur = (secs) => {
  if (secs <= 0) return "0m";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtTok = (n) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
};

// ── 1. Claude Code: 활성 5시간 블록 ────────────────────────
function getClaude() {
  try {
    const raw = execSync(`${CCUSAGE} blocks --active --json`, {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const data = JSON.parse(raw);
    const b =
      (data.blocks || []).find((x) => x.isActive) || (data.blocks || [])[0];
    if (!b) return null;
    const startTs = Math.floor(new Date(b.startTime).getTime() / 1000);
    const endTs = Math.floor(new Date(b.endTime).getTime() / 1000);
    const span = Math.max(1, endTs - startTs);
    const elapsedPct = Math.max(
      0,
      Math.min(100, ((now - startTs) / span) * 100),
    );
    return {
      elapsedPct,
      remainMin:
        b.projection?.remainingMinutes ??
        Math.max(0, Math.floor((endTs - now) / 60)),
      cost: b.costUSD || 0,
      tokens: b.totalTokens || 0,
      projCost: b.projection?.totalCost ?? null,
      costPerHour: b.burnRate?.costPerHour ?? null,
    };
  } catch (e) {
    return { error: String(e.message || e).split("\n")[0] };
  }
}

// ── 1b. Claude 오늘 모델별 사용 (Opus/Sonnet/Fable/Haiku) ──
const MODEL_NAMES = {
  "claude-fable-5": "Fable 5",
  "claude-opus-4-8": "Opus 4.8",
  "claude-opus-4-7": "Opus 4.7",
  "claude-sonnet-5": "Sonnet 5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};
const shortModel = (n) => MODEL_NAMES[n] || (n || "").replace("claude-", "");
function getClaudeModels() {
  try {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const raw = execSync(`${CCUSAGE} daily --breakdown --json --since ${ymd}`, {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const day = (JSON.parse(raw).daily || []).slice(-1)[0];
    if (!day) return null;
    const models = (day.modelBreakdowns || [])
      .map((m) => ({
        name: m.modelName,
        cost: m.cost || 0,
        tokens:
          (m.inputTokens || 0) +
          (m.outputTokens || 0) +
          (m.cacheCreationTokens || 0) +
          (m.cacheReadTokens || 0),
      }))
      .filter((m) => m.cost > 0.005)
      .sort((a, b) => b.cost - a.cost);
    if (!models.length) return null;
    return { models, total: models.reduce((s, m) => s + m.cost, 0) };
  } catch {
    return null;
  }
}

// ── 1c. Claude 실제 rate limit — Anthropic OAuth usage API 직접 조회 ──
// 이 맥의 Claude Code 로그인 토큰(키체인)으로 /usage와 같은 데이터를 서버에서 직접
// 가져온다. 수치는 계정 단위 합산이라 다른 디바이스·데스크톱앱·웹 사용분도 포함.
// 실패 시 폴백: 자체 캐시(마지막 성공 응답) → 레거시 usage-cache.json 파일.
const CLAUDE_STATE_DIR = `${HOME}/.claude/swiftbar`;
const CLAUDE_USAGE_CACHE = `${CLAUDE_STATE_DIR}/.claude-usage.json`;
const LEGACY_USAGE_FILES = [
  `${HOME}/.claude/MEMORY/STATE/usage-cache.json`,
  `${HOME}/.claude/PAI/MEMORY/STATE/usage-cache.json`,
];

// 토큰은 반환값으로만 존재 — 파일·로그·프로세스 인자 어디에도 남기지 않는다
function readClaudeToken() {
  // 옵트아웃: 키체인 접근/라이브 조회를 원치 않으면 `touch ~/.claude/swiftbar/.no-live`
  // — 키체인 프롬프트에서 '거부'를 누르면 2분마다 다시 뜨므로, 그 대신 이 스위치를 쓴다.
  if (existsSync(`${CLAUDE_STATE_DIR}/.no-live`)) return null;
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const t = JSON.parse(raw)?.claudeAiOauth?.accessToken;
    if (t) return t;
  } catch {}
  try {
    // 키체인이 없는 환경(예: 수동 이전) 대비 — Claude Code의 파일 자격증명
    const raw = readFileSync(`${HOME}/.claude/.credentials.json`, "utf8");
    return JSON.parse(raw)?.claudeAiOauth?.accessToken ?? null;
  } catch {}
  return null;
}

function fetchClaudeUsageLive() {
  const token = readClaudeToken();
  if (!token) return null;
  try {
    // Authorization 헤더는 stdin(-H @-)으로 전달 — ps 프로세스 목록에 토큰 노출 방지
    const raw = execSync(
      `/usr/bin/curl -fsS --max-time 5 -H @- -H "anthropic-beta: oauth-2025-04-20" https://api.anthropic.com/api/oauth/usage`,
      {
        encoding: "utf8",
        timeout: 8000,
        input: `Authorization: Bearer ${token}\n`,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const d = JSON.parse(raw);
    if (!d?.five_hour) return null;
    try {
      mkdirSync(CLAUDE_STATE_DIR, { recursive: true });
      writeFileSync(
        CLAUDE_USAGE_CACHE,
        JSON.stringify({ fetchedAt: Math.floor(Date.now() / 1000), data: d }),
      );
    } catch {}
    return { data: d, measuredAt: Math.floor(Date.now() / 1000), live: true };
  } catch {
    return null;
  }
}

function readClaudeUsageFallback() {
  try {
    const c = JSON.parse(readFileSync(CLAUDE_USAGE_CACHE, "utf8"));
    if (c?.data?.five_hour)
      return { data: c.data, measuredAt: c.fetchedAt ?? 0, live: false };
  } catch {}
  for (const f of LEGACY_USAGE_FILES) {
    try {
      const d = JSON.parse(readFileSync(f, "utf8"));
      if (d?.five_hour)
        return {
          data: d,
          measuredAt: Math.floor(statSync(f).mtimeMs / 1000),
          live: false,
        };
    } catch {}
  }
  return null;
}

// 5시간 세션 / 주간 전체 / Fable 주간(weekly_scoped) 사용률
function getClaudeUsage() {
  const src = fetchClaudeUsageLive() ?? readClaudeUsageFallback();
  if (!src) return null;
  const { data: d, measuredAt, live } = src;
  try {
    const toTs = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);
    const win = (o) =>
      o ? { pct: o.utilization ?? 0, resetsAt: toTs(o.resets_at) } : null;
    // Fable(또는 최상위 모델) 주간 scoped 한도
    let fable = null;
    for (const l of d.limits || []) {
      const mdl = l.scope?.model?.display_name;
      if (l.group === "weekly" && mdl) {
        fable = {
          pct: l.percent ?? 0,
          resetsAt: toTs(l.resets_at),
          model: mdl,
        };
        break;
      }
    }
    return {
      measuredAt,
      live,
      fiveHour: win(d.five_hour),
      weekly: win(d.seven_day),
      fable,
    };
  } catch {
    return null;
  }
}

// ── 2. Codex: 가장 신선한 rate_limits ──────────────────────
function walkJsonl(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkJsonl(p, out);
    else if (ent.name.endsWith(".jsonl")) {
      try {
        out.push({ path: p, mtime: statSync(p).mtimeMs });
      } catch {}
    }
  }
}
function getCodex() {
  if (!existsSync(CODEX_SESSIONS)) return null;
  const files = [];
  walkJsonl(CODEX_SESSIONS, files);
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(0, 8)) {
    try {
      const lines = readFileSync(f.path, "utf8").trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes("rate_limits")) continue;
        let obj;
        try {
          obj = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        const rl = obj.payload?.rate_limits ?? obj.rate_limits;
        // prolite=primary/secondary(%), premium=credits(잔액) — 둘 중 하나라도 있으면 유효
        if (rl && (rl.primary || rl.secondary || rl.credits)) {
          return {
            measuredAt: Math.floor(f.mtime / 1000),
            limitId: rl.limit_id || null,
            plan: rl.plan_type || null,
            primary: rl.primary || null,
            secondary: rl.secondary || null,
            credits: rl.credits || null,
          };
        }
      }
    } catch {}
  }
  return null;
}
function windowState(w) {
  if (!w) return null;
  const stale = w.resets_at && w.resets_at < now;
  return {
    pct: stale ? 0 : (w.used_percent ?? 0),
    resetsIn: w.resets_at ? w.resets_at - now : null,
    stale,
  };
}
// 소진 + 오래됨일 때만 하루 최대 몇 회 Codex를 백그라운드로 굴려 리셋 감지 (throttle 6h)
function maybeAutoRefreshCodex(codex) {
  try {
    if (!codex) return;
    // 소진 판정: credits 소진 OR 어떤 창이든 100% 사용
    let exhausted = false;
    if (codex.credits) {
      const cr = codex.credits;
      exhausted = !cr.unlimited && (!cr.has_credits || Number(cr.balance) <= 0);
    } else {
      const p = windowState(codex.primary),
        s = windowState(codex.secondary);
      exhausted = Boolean((p && p.pct >= 100) || (s && s.pct >= 100));
    }
    if (!exhausted) return;
    if (now - codex.measuredAt < 2 * 3600) return; // 2h+ 오래됐을 때만
    const tsFile = `${HOME}/.claude/swiftbar/.codex-refresh-ts`;
    let last = 0;
    try {
      last = parseInt(readFileSync(tsFile, "utf8").trim(), 10) || 0;
    } catch {}
    if (now - last < 6 * 3600) return; // throttle: 6h 간격 (하루 최대 4회)
    writeFileSync(tsFile, String(now));
    // detached 백그라운드 실행 — 위젯을 막지 않음. 완료되면 세션 로그 갱신됨.
    const child = spawn(
      "/bin/sh",
      [
        "-c",
        `echo "reply ok" | "${CODEX_BIN}" exec --sandbox read-only --skip-git-repo-check - >/dev/null 2>&1`,
      ],
      { detached: true, stdio: "ignore", cwd: HOME },
    );
    child.unref();
  } catch {}
}

// ── 렌더링 ─────────────────────────────────────────────────
const claude = getClaude();
const cusage = getClaudeUsage();
const cmodels = getClaudeModels();
const codex = getCodex();
maybeAutoRefreshCodex(codex); // 소진+오래됨 시 백그라운드 갱신 (throttle)
const out = [];

// 메뉴바: 배터리 잔량 아이콘 (전부 "남은 %")
//   Claude(usage-cache): C5=5시간세션 · CW=주간전체 · CF=Fable 주간
//   Codex(rate_limits) : X5=5시간 · XW=주간
const rem = (pct) => (pct == null ? null : Math.max(0, 100 - pct));
// 한쪽만 쓰는 사용자 대응: 데이터가 있는 서비스만 표시
const hasClaude = !!cusage || !!(claude && !claude.error);
const hasCodex = !!codex;
const battItems = [];
// Claude — usage-cache 있으면 3종, 없어도 ccusage 블록이 있으면 C5만. 둘 다 없으면 Claude 배터리 생략.
if (cusage) {
  battItems.push({ label: "C5", remain: rem(cusage.fiveHour?.pct) });
  battItems.push({ label: "CW", remain: rem(cusage.weekly?.pct) });
  if (cusage.fable)
    battItems.push({ label: "CF", remain: rem(cusage.fable.pct) });
} else if (claude && !claude.error) {
  battItems.push({ label: "C5", remain: Math.max(0, 100 - claude.elapsedPct) });
}
// Codex — 세션 데이터 있을 때만. Codex 안 쓰는 사람에겐 X 배터리 자체를 안 그림.
if (codex && (codex.primary || codex.secondary)) {
  // prolite: 5시간·주간 % 창
  const p = windowState(codex.primary);
  const s = windowState(codex.secondary);
  battItems.push({ label: "X5", remain: p ? Math.max(0, 100 - p.pct) : null });
  battItems.push({ label: "XW", remain: s ? Math.max(0, 100 - s.pct) : null });
} else if (codex && codex.credits) {
  // premium: 크레딧 잔액 (총량 미제공 → 있음=100 / 소진=0 / 무제한=100)
  const cr = codex.credits;
  const remain = cr.unlimited
    ? 100
    : cr.has_credits && Number(cr.balance) > 0
      ? 100
      : 0;
  battItems.push({ label: "X", remain });
}
// 메뉴바: 네이티브 SF Symbol 배터리 (벡터 — 어떤 화면에서도 선명, 도트 없음).
// 채움은 SF 심볼 5단계(0/25/50/75/100), 색은 심볼별 sfcolorN. 크기 프리셋 → size=.
const battSymbol = (r) =>
  r == null
    ? "battery.0"
    : r >= 88
      ? "battery.100"
      : r >= 63
        ? "battery.75"
        : r >= 38
          ? "battery.50"
          : r >= 13
            ? "battery.25"
            : "battery.0";
function sfBatteryLine(dark, items) {
  const ink = dark ? "#EBEBEB" : "#2D2D2D";
  const fontSize = SIZE === "small" ? 12 : 15; // big/small 프리셋 → SF 심볼 크기
  const parts = [];
  const colors = [];
  let pg = null;
  for (const it of items) {
    const g = it.label[0]; // 그룹 문자 C=Claude / X=Codex
    if (g !== pg) {
      parts.push((pg !== null ? " " : "") + g); // 그룹 앞 라벨(시스템폰트 텍스트)
      pg = g;
    }
    parts.push(`:${battSymbol(it.remain)}:`);
    colors.push(it.remain == null ? "#8B949E" : heatRemainHex(it.remain));
  }
  // sfcolorN은 등장 순서대로 각 심볼에 매핑 (텍스트 라벨은 인덱스를 소비하지 않음)
  const sf = colors
    .map((c, i) => (i === 0 ? `sfcolor=${c}` : `sfcolor${i + 1}=${c}`))
    .join(" ");
  return `${parts.join(" ")} | ${sf} color=${ink} size=${fontSize}`;
}
// 표시 모드 5h: 현재(5시간) 창만 — C5·X5 (premium 크레딧 X는 유일한 Codex 배터리라 유지)
const shownItems =
  MODE === "5h"
    ? battItems.filter((it) => ["C5", "X5", "X"].includes(it.label))
    : battItems;
// 둘 다 없으면(신규/양쪽 미사용) 배터리 대신 안내 아이콘.
if (shownItems.length) {
  out.push(sfBatteryLine(isDarkMode(), shownItems));
} else {
  out.push("🔋 —");
}
out.push("---");
const codexLegend =
  codex?.credits && !codex.primary && !codex.secondary
    ? "X = Codex 크레딧"
    : MODE === "5h"
      ? "X = Codex 5시간"
      : "X5·XW = Codex 5시간·주간";
const legendParts = [];
if (hasClaude)
  legendParts.push(
    MODE === "5h" ? "C = Claude 5시간" : "C5·CW·CF = Claude 5시간·주간·Fable",
  );
if (hasCodex) legendParts.push(codexLegend);
if (legendParts.length) {
  out.push(
    `🔋 남은 %  ·  ${legendParts.join("  ·  ")} | size=11 color=#8b949e`,
  );
  out.push("---");
}

// Claude 상세 — hasClaude일 때만 (Claude Code 안 쓰면 섹션 자체 생략)
if (hasClaude) {
  out.push("Claude Code | size=13 color=#8b949e");
  if (cusage) {
    const winRow = (label, w) => {
      if (!w) return;
      const r = Math.max(0, 100 - (w.pct ?? 0));
      const reset = w.resetsAt
        ? w.resetsAt < now
          ? "리셋됨"
          : `리셋 ${fmtDur(w.resetsAt - now)}`
        : "";
      out.push(
        `${label} ▕${bar(r, 20)}▏ ${Math.round(r)}%  (사용 ${Math.round(w.pct ?? 0)}%)${reset ? "  ·  " + reset : ""} | font=Menlo color=${heatRemainHex(r)}`,
      );
    };
    winRow("5시간 남음", cusage.fiveHour);
    winRow("주간 남음 ", cusage.weekly);
    if (cusage.fable) winRow(`${cusage.fable.model} 남음`, cusage.fable);
    out.push(
      cusage.live
        ? `라이브 (Anthropic usage API — 전 디바이스 합산) | size=11 color=#8b949e`
        : `측정 ${fmtDur(now - cusage.measuredAt)} 전 (캐시 폴백 — Claude Code 로그인·네트워크 확인) | size=11 color=#d29922`,
    );
  }
  if (claude && !claude.error) {
    out.push(
      `블록 비용  $${claude.cost.toFixed(2)}  ·  ${fmtTok(claude.tokens)} 토큰  ·  $${claude.costPerHour?.toFixed(1) ?? "?"}/h | font=Menlo size=11 color=#8b949e`,
    );
  }
  // 오늘 모델별 사용 (최대 모델 대비 막대)
  if (cmodels && cmodels.models.length) {
    out.push(
      `오늘 모델별  ·  합 $${cmodels.total.toFixed(0)} | size=11 color=#8b949e`,
    );
    const maxCost = cmodels.models[0].cost || 1;
    for (const m of cmodels.models) {
      const g = bar((m.cost / maxCost) * 100, 12);
      const label = shortModel(m.name).padEnd(9, " ");
      out.push(
        `${label}▕${g}▏ $${m.cost.toFixed(1)}  ${fmtTok(m.tokens)} | font=Menlo`,
      );
    }
  }
  out.push("---");
}

// Codex 상세 — hasCodex일 때만 (Codex 안 쓰면 섹션 자체 생략)
if (hasCodex) {
  out.push(
    `Codex${codex?.plan ? " · " + codex.plan : codex?.limitId ? " · " + codex.limitId : ""} | size=13 color=#8b949e`,
  );
  const p = windowState(codex.primary);
  const s = windowState(codex.secondary);
  // premium: primary/secondary 없이 크레딧 잔액만
  if (!p && !s && codex.credits) {
    const cr = codex.credits;
    if (cr.unlimited) {
      out.push("크레딧  무제한 | font=Menlo color=#3fb950");
    } else if (!cr.has_credits || Number(cr.balance) <= 0) {
      out.push("크레딧  소진 · 한도 초과 (0) | font=Menlo color=#f85149");
      out.push(
        "      Codex 설정에서 크레딧 구매 또는 리셋 대기 | font=Menlo size=11 color=#8b949e",
      );
    } else {
      out.push(`크레딧  잔액 ${cr.balance} | font=Menlo color=#3fb950`);
    }
  }
  if (p) {
    const reset = p.stale
      ? "리셋됨"
      : p.resetsIn != null
        ? `리셋 ${fmtDur(p.resetsIn)}`
        : "";
    const pr = Math.max(0, 100 - p.pct);
    out.push(
      `5시간 남음 ▕${bar(pr, 20)}▏ ${Math.round(pr)}%  (사용 ${Math.round(p.pct)}%) | font=Menlo color=${heatRemainHex(pr)}`,
    );
    out.push(`      ${reset} | font=Menlo size=11 color=#8b949e`);
  }
  if (s) {
    const reset = s.stale
      ? "리셋됨"
      : s.resetsIn != null
        ? `리셋 ${fmtDur(s.resetsIn)}`
        : "";
    const sr = Math.max(0, 100 - s.pct);
    out.push(
      `주간 남음  ▕${bar(sr, 20)}▏ ${Math.round(sr)}%  (사용 ${Math.round(s.pct)}%) | font=Menlo color=${heatRemainHex(sr)}`,
    );
    out.push(`      ${reset} | font=Menlo size=11 color=#8b949e`);
  }
  const age = now - codex.measuredAt;
  const staleWarn = age > 3 * 3600; // 3시간+ 오래됨 → 리셋됐을 수 있음
  out.push(
    `측정 ${fmtDur(age)} 전${staleWarn ? "  ·  ⚠ 리셋됐을 수 있음, Codex 쓰면 갱신" : " (Codex 세션 기준)"} | size=11 color=${staleWarn ? "#d29922" : "#8b949e"}`,
  );
  out.push("---");
}

// 둘 다 없으면(신규/양쪽 미사용) 안내
if (!hasClaude && !hasCodex) {
  out.push(
    "Claude Code나 Codex를 실행하면 사용량이 표시됩니다 | size=12 color=gray",
  );
  out.push("---");
}

// 새 버전이 있으면 강조 원클릭 업데이트, 없어도 수동 업데이트 행은 항상 노출
const upd = getUpdateInfo();
if (upd.hasUpdate) {
  out.push(
    `🆕 v${upd.latest} 업데이트 (현재 v${VERSION}) | bash="${SELF_DIR}/.ccb-update.sh" terminal=false refresh=true color=#28963f`,
  );
} else {
  out.push(
    `⬆️ 지금 업데이트 — GitHub 최신으로 교체 (현재 v${VERSION}) | bash="${SELF_DIR}/.ccb-update.sh" terminal=false refresh=true`,
  );
}
out.push("🔄 지금 새로고침 | refresh=true");
// ccusage가 있을 때만(선택 의존) 대시보드 바로가기 노출
if (claude && !claude.error) {
  out.push(
    `📊 ccusage 대시보드 열기 | bash="${CCUSAGE}" param1=blocks param2=--active terminal=true`,
  );
}
out.push(
  `v${VERSION}  ·  Claude & Codex Usage Battery | size=11 color=#8b949e`,
);
// 크기 전환 — .batt-size 파일에 반대 프리셋을 기록하고 즉시 새로고침
{
  const other = SIZE === "big" ? "small" : "big";
  out.push(
    `↕ 배터리 크기: ${SIZE === "big" ? "크게 (기본)" : "작게"} — 클릭하면 ${other === "big" ? "크게" : "작게"}로 | bash=/bin/sh param1=-c param2="mkdir -p '${HOME}/.claude/swiftbar' && echo ${other} > '${SIZE_FILE}'" terminal=false refresh=true size=11 color=#8b949e`,
  );
}
// 표시 모드 전환 — .batt-mode 파일에 반대 모드를 기록하고 즉시 새로고침
{
  const otherMode = MODE === "all" ? "5h" : "all";
  out.push(
    `🔋 배터리 표시: ${MODE === "all" ? "전체 (기본)" : "현재 5시간만"} — 클릭하면 ${otherMode === "all" ? "전체로" : "현재 5시간만으로"} | bash=/bin/sh param1=-c param2="mkdir -p '${HOME}/.claude/swiftbar' && echo ${otherMode} > '${MODE_FILE}'" terminal=false refresh=true size=11 color=#8b949e`,
  );
}
out.push(
  `⭐ github.com/jason191188/claude-codex-battery | href=https://github.com/jason191188/claude-codex-battery size=11 color=#8b949e`,
);
// 위젯 끄기 — SwiftBar의 플러그인 비활성화 URL. 재활성화: SwiftBar 메뉴 → Plugins
out.push(
  `✕ 위젯 끄기 (SwiftBar 설정에서 재활성화) | href=swiftbar://disableplugin?plugin=claude-codex-usage size=11 color=#8b949e`,
);

console.log(out.join("\n"));
