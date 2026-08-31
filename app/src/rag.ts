// rag.ts — 검색·프롬프트·답변 로직 (어르신 디지털 안내 RAG)
export interface Doc { id: string; text: string; url: string; section: string; vector: number[]; }
export interface Hit { id: string; text: string; url: string; section: string; cosine: number; bm25: number; method: "vector" | "bm25" | "both"; rrf: number; }

/* 배포 형태에 따라 아래 5개가 달라진다. 환경변수가 없으면 전부 제출용 기본값이다. */
const OLLAMA = import.meta.env.VITE_OLLAMA_URL || "http://localhost:11434";
const HEALTH_PATH = import.meta.env.VITE_HEALTH_PATH || "/api/tags"; // 실사용판은 프록시의 /api/health
const CONTEXT_K = Number(import.meta.env.VITE_CONTEXT_K) || 6; // 프롬프트에 넣는 근거 개수. 노트북 CPU에서 대기 시간을 좌우한다
const KEEP_ALIVE = import.meta.env.VITE_KEEP_ALIVE || ""; // 모델 상주 시간. 비면 필드를 안 보내 Ollama 기본값(5분)
const keepAlive = KEEP_ALIVE ? { keep_alive: KEEP_ALIVE } : {};
export const EMBED_MODEL = "embeddinggemma";
export const CHAT_MODEL = "qwen3.5:2b";
export const THRESHOLD = 0.33;
export const REFUSE = 0.30;
const BM25_MIN = 6.0;
const K_VEC = 10, K_BM25 = 5, RRF_K = 60;

export async function embed(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA}/api/embed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: EMBED_MODEL, input: text }) });
  if (!r.ok) throw new Error(`임베딩 실패 ${r.status}`);
  return (await r.json()).embeddings[0];
}

function bigrams(s: string): string[] { const c = s.replace(/\s+/g, ""); const g: string[] = []; for (let i = 0; i < c.length - 1; i++) g.push(c.slice(i, i + 2)); return g; }
function cos(a: number[], b: number[]): number { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb); }

export function buildSearcher(docs: Doc[]) {
  const N = docs.length;
  const docToks = docs.map((d) => bigrams(d.text));
  const avgdl = docToks.reduce((s, t) => s + t.length, 0) / N;
  const df: Record<string, number> = {};
  for (const toks of docToks) for (const w of new Set(toks)) df[w] = (df[w] || 0) + 1;
  function bm25(qToks: string[], i: number): number {
    const toks = docToks[i], dl = toks.length, tf: Record<string, number> = {};
    for (const w of toks) tf[w] = (tf[w] || 0) + 1;
    const k1 = 1.5, b = 0.75; let s = 0;
    for (const w of new Set(qToks)) { if (!tf[w]) continue; const idf = Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5)); s += idf * (tf[w] * (k1 + 1)) / (tf[w] + k1 * (1 - b + b * dl / avgdl)); }
    return s;
  }
  return async function search(query: string): Promise<{ hits: Hit[]; weak: boolean; refuse: boolean; maxCos: number }> {
    const qv = await embed(query);
    const vec = docs.map((d, i) => ({ i, score: cos(qv, d.vector) })).sort((a, b) => b.score - a.score);
    const qT = bigrams(query);
    const bm = docs.map((_d, i) => ({ i, score: bm25(qT, i) })).sort((a, b) => b.score - a.score);
    const m = new Map<number, Record<string, number>>();
    const add = (arr: { i: number; score: number }[], key: string) => arr.forEach((r, idx) => { const e = m.get(r.i) || { i: r.i }; e[key] = r.score; e[key + "Rank"] = idx + 1; m.set(r.i, e); });
    add(vec.slice(0, K_VEC), "vector");
    add(bm.slice(0, K_BM25).filter((x) => x.score > 0), "bm25");
    const hits: Hit[] = [...m.values()].map((e) => {
      const rrf = (e.vectorRank ? 1 / (RRF_K + e.vectorRank) : 0) + (e.bm25Rank ? 1 / (RRF_K + e.bm25Rank) : 0);
      const method = e.vector != null && e.bm25 != null ? "both" : e.vector != null ? "vector" : "bm25";
      const d = docs[e.i];
      return { id: d.id, text: d.text, url: d.url, section: d.section, cosine: e.vector ?? cos(qv, d.vector), bm25: e.bm25 ?? 0, method: method as Hit["method"], rrf };
    }).sort((a, b) => b.rrf - a.rrf);
    const maxCos = Math.max(...hits.map((h) => h.cosine));
    const maxBm25 = hits.length ? Math.max(...hits.map((h) => h.bm25)) : 0;
    const strong = maxBm25 >= BM25_MIN;
    return { hits, weak: maxCos < THRESHOLD && !strong, refuse: maxCos < REFUSE && !strong, maxCos };
  };
}

export function buildPrompt(query: string, hits: Hit[], weak: boolean): { system: string; user: string } {
  const context = hits.slice(0, CONTEXT_K).map((h) => `[${h.id}] (${h.section}) ${h.text}\n출처: ${h.url}`).join("\n\n");
  const system = [
    "당신은 어르신 디지털·스마트폰 안내 도우미입니다. 아래 '자료'에 근거해서만 한국어 존댓말로 답하세요. 반드시 한국어로만 쓰고 한자나 중국어, 불필요한 영어 단어를 쓰지 마세요.",
    "규칙:",
    "1. 답변에 사용한 근거의 [ID]를 문장 뒤에 표시하세요. 예: ...입니다 [SD-004].",
    "2. 자료에 없는 내용(기관명·전화번호·URL·숫자)을 지어내지 마세요.",
    "3. 어려운 용어는 풀어서 쉽게 설명하세요.",
    weak ? "4. 지금은 근거가 약합니다. 단정하지 말고 '정확한 내용은 확인이 필요합니다'라고 조심스럽게 답하세요." : "4. 근거가 충분하면 명확히 답하세요.",
    "5. 자료 범위 밖 질문이면 지어내지 말고 '안내 범위 밖입니다'라고 정중히 알리세요.",
  ].join("\n");
  const user = `자료:\n${context}\n\n질문: ${query}`;
  return { system, user };
}

export async function* chatStream(system: string, user: string, signal?: AbortSignal): AsyncGenerator<string> {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ model: CHAT_MODEL, stream: true, think: false, options: { temperature: 0.3 }, ...keepAlive, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!r.ok || !r.body) throw new Error(`채팅 실패 ${r.status}`);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (j.message?.content) yield j.message.content as string; } catch { /* 부분 조각 무시 */ }
    }
  }
}

export async function checkOllama(): Promise<{ ok: boolean; hasChat: boolean; hasEmbed: boolean }> {
  try {
    const r = await fetch(`${OLLAMA}${HEALTH_PATH}`);
    if (!r.ok) return { ok: false, hasChat: false, hasEmbed: false };
    const j = await r.json();
    if (typeof j.ok === "boolean") return { ok: j.ok, hasChat: !!j.hasChat, hasEmbed: !!j.hasEmbed };
    const names: string[] = (j.models || []).map((m: { name: string }) => m.name);
    return { ok: true, hasChat: names.some((n) => n.startsWith(CHAT_MODEL)), hasEmbed: names.some((n) => n.startsWith(EMBED_MODEL)) };
  } catch { return { ok: false, hasChat: false, hasEmbed: false }; }
}

export interface Judgement { grounded: boolean; noHalluc: boolean; cited: boolean; refusal: boolean; score: number; comment: string; }

export async function judge(query: string, answer: string, hits: Hit[]): Promise<Judgement> {
  const context = hits.slice(0, CONTEXT_K).map((h) => `[${h.id}] ${h.text}`).join("\n");
  const sys = "당신은 RAG 답변을 평가하는 채점자입니다. 자료·질문·답변을 읽고 아래 6개 기준을 JSON으로만 출력하세요. 다른 말은 하지 마세요.";
  const rubric = [
    "기준(true/false):",
    "- grounded: 답변 내용이 자료 안에 근거가 있으면 true",
    "- noHalluc: 자료에 없는 사실(기관명·전화번호·URL·숫자)을 지어내지 않았으면 true",
    "- cited: 답변에 [ID] 형식 근거 표시가 있으면 true (거부 답변이면 없어도 true)",
    "- refusal: 답변이 '안내 범위 밖' 등으로 정중히 거부했으면 true",
    "- score: 0~100 정수, comment: 한국어 한 문장 평가",
    "refusal이 true이면 grounded/noHalluc/cited는 관대하게 봅니다.",
    '반드시 {"grounded":bool,"noHalluc":bool,"cited":bool,"refusal":bool,"score":int,"comment":"..."} 형식만 출력.',
  ].join("\n");
  const user = `${rubric}\n\n[자료]\n${context}\n\n[질문] ${query}\n\n[답변] ${answer}`;
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: CHAT_MODEL, stream: false, think: false, format: "json", options: { temperature: 0 }, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`judge 실패 ${r.status}`);
  const data = await r.json();
  const p = JSON.parse(data.message.content) as Record<string, unknown>;
  return {
    grounded: !!p.grounded, noHalluc: !!p.noHalluc, cited: !!p.cited,
    refusal: !!p.refusal, score: Number(p.score) || 0, comment: String(p.comment ?? ""),
  };
}
