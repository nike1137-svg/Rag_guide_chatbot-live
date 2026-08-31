// 이음이 보호 프록시
//
// Ollama API에는 인증이 없다. 주소만 알면 누구나 모델을 지우거나 받을 수 있다.
// 그래서 Ollama(11434)를 터널에 직접 노출하지 않고 이 프록시(8787)만 내보낸다.
//
// 하는 일은 아래 여덟 가지뿐이다. 더 늘리지 않는다.
//   1. 경로 화이트리스트 (chat / embed / health 셋만)
//   2. /api/health — 모델 목록을 감추고 판정 결과만 준다
//   3. OPTIONS 프리플라이트 응답
//   4. CORS 오리진 화이트리스트
//   5. 본문 크기 제한
//   6. 모델 고정
//   7. 레이트리밋
//   8. 스트리밍 그대로 통과
//
// 외부 패키지를 쓰지 않는다. Node 내장 모듈만 쓴다.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 작업 스케줄러로 띄우면 환경변수를 넘기기가 번거롭다.
// 그래서 server.mjs 옆의 proxy.env 파일을 읽어 비어 있는 값만 채운다.
// 이미 환경변수가 설정돼 있으면 그쪽이 이긴다.
const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, "proxy.env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    const v = s.slice(i + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
  console.log("[설정] " + envFile);
}

const PORT = Number(process.env.PROXY_PORT) || 8787;
const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN) || 30;
const MAX_BODY = Number(process.env.MAX_BODY) || 16 * 1024;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",").map((s) => s.trim()).filter(Boolean);

// 이 두 개만 통과시킨다. 요청이 보내온 model 값은 믿지 않는다.
const CHAT_MODEL = "qwen3.5:2b";
const EMBED_MODEL = "embeddinggemma";

// ---------------------------------------------------------------- 유틸

// 클라이언트 IP.
// cloudflared는 노트북 안에서 이 프록시에 붙으므로, 그냥 두면 모든 외부 사용자가
// 127.0.0.1 하나로 보여 레이트리밋이 전체 한도로 바뀐다.
// 그래서 CF-Connecting-IP를 쓰되, 루프백에서 들어온 연결일 때만 믿는다.
// (아니면 헤더를 위조해 한도를 우회할 수 있다.)
function clientIp(req) {
  const ra = req.socket.remoteAddress || "";
  const loopback = ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
  if (loopback) {
    const cf = req.headers["cf-connecting-ip"];
    if (cf) return String(cf).split(",")[0].trim();
  }
  return ra;
}

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now >= e.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + 60000 });
    return false;
  }
  e.count += 1;
  return e.count > RATE_PER_MIN;
}
// 오래된 항목 정리. 메모리만 쓰므로 프록시를 다시 띄우면 초기화된다.
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of hits) if (now >= e.resetAt) hits.delete(ip);
}, 60000).unref();

function corsHeaders(origin) {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function send(res, code, obj, cors) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...(cors || {}),
  });
  res.end(body);
}

function readBody(req, res, cors) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        send(res, 413, { error: "요청이 너무 큽니다." }, cors);
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

// ---------------------------------------------------------------- 본체

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const origin = req.headers.origin;
  const cors = corsHeaders(origin);

  // 3. 프리플라이트. 이게 없으면 브라우저가 본 요청을 아예 보내지 않는다.
  //    curl 검사는 프리플라이트를 보내지 않으므로 이 구멍은 브라우저에서만 드러난다.
  if (req.method === "OPTIONS") {
    if (!cors) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(204, cors).end();
    return;
  }

  // 4. 오리진 화이트리스트. 브라우저 요청인데 허용 목록 밖이면 막는다.
  //    (Origin 헤더가 없는 요청 = curl 등 도구. 이건 브라우저 보안 대상이 아니라 통과시킨다.)
  if (origin && !cors) {
    send(res, 403, { error: "허용되지 않은 주소입니다." }, null);
    return;
  }

  // 7. 레이트리밋
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    send(res, 429, { error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." }, cors);
    return;
  }

  // 2. 연결 확인. Ollama의 /api/tags를 프록시가 대신 확인하고 결과만 요약해서 준다.
  //    모델 목록 자체는 절대 내보내지 않는다.
  if (req.method === "GET" && path === "/api/health") {
    try {
      const r = await fetch(OLLAMA + "/api/tags");
      if (!r.ok) {
        send(res, 200, { ok: false, hasChat: false, hasEmbed: false }, cors);
        return;
      }
      const j = await r.json();
      const names = (j.models || []).map((m) => String(m.name));
      send(res, 200, {
        ok: true,
        hasChat: names.some((n) => n.startsWith(CHAT_MODEL)),
        hasEmbed: names.some((n) => n.startsWith(EMBED_MODEL)),
      }, cors);
    } catch {
      send(res, 200, { ok: false, hasChat: false, hasEmbed: false }, cors);
    }
    return;
  }

  // 1. 경로 화이트리스트. 나머지는 전부 404.
  //    /api/tags, /api/delete, /api/pull 등이 여기서 걸린다.
  if (req.method !== "POST" || (path !== "/api/chat" && path !== "/api/embed")) {
    send(res, 404, { error: "없는 경로입니다." }, cors);
    return;
  }

  // 5. 본문 크기 제한
  const raw = await readBody(req, res, cors);
  if (raw === null) return;

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    send(res, 400, { error: "잘못된 요청 형식입니다." }, cors);
    return;
  }

  // 6. 모델 고정. 요청이 보내온 값을 믿지 않고 우리가 아는 두 개만 통과시킨다.
  const want = path === "/api/chat" ? CHAT_MODEL : EMBED_MODEL;
  if (body.model !== want) {
    send(res, 400, { error: "허용되지 않은 모델입니다." }, cors);
    return;
  }

  // 8. 스트리밍 통과. 중간에 모아두면 어르신 화면이 멈춘 것처럼 보인다.
  const ac = new AbortController();
  req.on("close", () => ac.abort());

  try {
    const up = await fetch(OLLAMA + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
      signal: ac.signal,
      duplex: "half",
    });

    res.writeHead(up.status, {
      "Content-Type": up.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      ...(cors || {}),
    });

    if (!up.body) {
      res.end();
      return;
    }
    for await (const chunk of up.body) {
      if (!res.write(Buffer.from(chunk))) {
        await new Promise((r) => res.once("drain", r));
      }
    }
    res.end();
  } catch (e) {
    if (ac.signal.aborted) {
      res.destroy();
      return;
    }
    if (!res.headersSent) {
      send(res, 502, { error: "모델 서버에 연결하지 못했습니다." }, cors);
    } else {
      res.end();
    }
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const stamp = new Date().toLocaleString("ko-KR");
  console.log("[이음이 프록시] " + stamp + " 시작  http://127.0.0.1:" + PORT);
  console.log("  Ollama       " + OLLAMA);
  console.log("  허용 오리진   " + ALLOWED_ORIGINS.join("  "));
  console.log("  레이트리밋    IP당 분당 " + RATE_PER_MIN + "회");
  console.log("  본문 상한     " + MAX_BODY + " byte");
});
