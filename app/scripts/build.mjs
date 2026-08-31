// 제출용/실사용판 빌드를 한 곳에서 가른다.
// PowerShell의 $env: 는 창이 닫힐 때까지 남아 두 빌드가 섞이는 사고를 낸다.
// 그래서 이 스크립트가 매번 VITE_* 를 전부 지우고 필요한 값만 다시 넣는다.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const mode = process.argv[2];
if (mode !== "submit" && mode !== "live") {
  console.error("사용법: node scripts/build.mjs submit|live");
  process.exit(1);
}

// 1) 물려받은 VITE_* 를 전부 제거한다. 이게 이 스크립트의 핵심이다.
for (const k of Object.keys(process.env)) if (k.startsWith("VITE_")) delete process.env[k];

if (mode === "live") {
  // 2) 실사용판 값은 .env.live 파일에서만 읽는다(커밋 금지 파일).
  if (!existsSync(".env.live")) {
    console.error("`.env.live` 가 없습니다. .env.example 을 보고 만들어 주세요.");
    process.exit(1);
  }
  for (const line of readFileSync(".env.live", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1].startsWith("VITE_")) process.env[m[1]] = m[2].trim();
  }
  if (!process.env.VITE_OLLAMA_URL) {
    console.error(".env.live 에 VITE_OLLAMA_URL 이 없습니다.");
    process.exit(1);
  }
  // 실사용판 고정값. .env.live 에 적었으면 그 값을 존중한다.
  const fixed = {
    VITE_BASE: "/",
    VITE_HEALTH_PATH: "/api/health",
    VITE_JUDGE: "off",
    VITE_CONTEXT_K: "3",
    VITE_KEEP_ALIVE: "30m",
    VITE_HOSTED: "1",
  };
  for (const [k, val] of Object.entries(fixed)) if (!process.env[k]) process.env[k] = val;
}

const shown = Object.keys(process.env).filter((k) => k.startsWith("VITE_")).sort();
console.log(`[build:${mode}] ` + (shown.length ? shown.map((k) => `${k}=${process.env[k]}`).join("  ") : "환경변수 없음 (제출용 기본값)"));

// Windows에서는 npm이 .cmd 라 shell 없이는 실행되지 않는다(Node 20+ 보안 변경).
const r = spawnSync("npm", ["run", "build"], { stdio: "inherit", env: process.env, shell: true });
if (r.error) {
  console.error("빌드 실행 실패:", r.error.message);
  process.exit(1);
}
process.exit(r.status ?? 1);
