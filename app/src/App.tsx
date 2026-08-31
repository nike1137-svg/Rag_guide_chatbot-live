import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildPrompt,
  buildSearcher,
  chatStream,
  checkOllama,
  judge,
  CHAT_MODEL,
  EMBED_MODEL,
  type Doc,
  type Hit,
  type Judgement,
} from "./rag";

const BASE = import.meta.env.BASE_URL;
/* 자동판정은 채점 루브릭용 기능이다. 어르신용 실사용판에서는 버튼을 감춘다. */
const JUDGE_ON = import.meta.env.VITE_JUDGE !== "off";
/* 실사용판(도메인 배포)에서는 답변을 마커스님 노트북이 만든다.
   방문자에게 Ollama를 설치하라고 하면 틀린 안내가 되므로 문구를 가른다. */
const HOSTED = import.meta.env.VITE_HOSTED === "1";

/* 브라우저 음성 입력(Web Speech API)은 표준 타입 정의에 없어 필요한 만큼만 선언한다. */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/* Ollama가 없는 방문자에게 보여 줄 실행 기록 (app/public/demo.json) */
type DemoCase = {
  question: string;
  answer: string;
  weak: boolean;
  refuse: boolean;
  maxCos: number;
  hits: Hit[];
  judge: Judgement;
};
type DemoFile = { recordedAt: string; model: string; cases: DemoCase[] };

type Status = {
  checked: boolean;
  ollama: boolean;
  chat: boolean;
  embed: boolean;
  docs: number;
};

const FAQ_ITEMS = [
  { text: "보이스피싱이 의심되면 어떻게 해야 하나요?", icon: "phone" },
  { text: "디지털배움터는 어떤 곳인가요?", icon: "school" },
  { text: "무인민원발급기는 어떻게 사용하나요?", icon: "kiosk" },
  { text: "스미싱 문자가 왔는데 어떻게 하죠?", icon: "message" },
  { text: "정부24는 어떤 서비스인가요?", icon: "gov" },
] as const;

const METHOD_LABEL: Record<Hit["method"], string> = {
  vector: "의미 검색",
  bm25: "낱말 검색",
  both: "의미 + 낱말",
};

/* 답변을 소리로 읽을 때는 [SD-000] 표시가 방해되므로 그때만 걷어낸다. */
function stripCitations(text: string): string {
  return text
    .replace(/\[SD-\d+(?:\s*,\s*SD-\d+)*\]/g, "")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function Icon({ name, className }: { name: string; className?: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
  switch (name) {
    case "phone":
      return (
        <svg {...common}>
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
        </svg>
      );
    case "school":
      return (
        <svg {...common}>
          <path d="M2 8.5 12 4l10 4.5-10 4.5z" />
          <path d="M6 10.7V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.3" />
        </svg>
      );
    case "kiosk":
      return (
        <svg {...common}>
          <rect x="5" y="2" width="14" height="14" rx="2" />
          <path d="M8 6h8M8 10h5" />
          <path d="M9 16v6h6v-6" />
        </svg>
      );
    case "message":
      return (
        <svg {...common}>
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.9-.9L3 21l1.9-4.1A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
        </svg>
      );
    case "gov":
      return (
        <svg {...common}>
          <path d="M3 21h18M4 21V10M20 21V10M12 3 3 8h18z" />
          <path d="M8 21v-6M16 21v-6" />
        </svg>
      );
    case "sound":
      return (
        <svg {...common}>
          <path d="M11 5 6 9H3v6h3l5 4z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
      );
    case "mic":
      return (
        <svg {...common}>
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
        </svg>
      );
    case "stop":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      );
    case "warning":
      return (
        <svg {...common}>
          <path d="M12 3 2.5 20h19z" />
          <path d="M12 9v5M12 17.5v.01" />
        </svg>
      );
    case "up":
      return (
        <svg {...common}>
          <path d="M7 22V10l5-8a2.5 2.5 0 0 1 2.4 3.2L13.5 9H19a2 2 0 0 1 2 2.4l-1.4 8A2 2 0 0 1 17.6 21H7z" />
        </svg>
      );
    case "down":
      return (
        <svg {...common}>
          <path d="M17 2v12l-5 8a2.5 2.5 0 0 1-2.4-3.2l.9-3.8H5a2 2 0 0 1-2-2.4l1.4-8A2 2 0 0 1 6.4 3H17z" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3A5 5 0 0 0 13.5 3.5l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3A5 5 0 0 0 10.5 20.5l1.7-1.7" />
        </svg>
      );
    default:
      return null;
  }
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1500);
          },
          () => setDone(false),
        );
      }}
    >
      {done ? "복사됨" : "복사"}
    </button>
  );
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  return (
    <div className="cmd-row">
      <span className="cmd-label">{label}</span>
      <code className="cmd-code">{command}</code>
      <CopyButton text={command} />
    </div>
  );
}

/* 답변 안의 [SD-000] 표시를 눈에 띄게 남긴다 — 근거가 붙은 문장임을 화면에서 보이기 위함. */
function AnswerBody({ text }: { text: string }) {
  const parts = text.split(/(\[SD-\d+(?:\s*,\s*SD-\d+)*\])/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\[SD-/.test(part) ? (
          <span key={i} className="cite-mark">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export default function App() {
  const [status, setStatus] = useState<Status>({
    checked: false,
    ollama: false,
    chat: false,
    embed: false,
    docs: 0,
  });
  const [rechecking, setRechecking] = useState(false);
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [weak, setWeak] = useState(false);
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"" | "up" | "down">("");
  const [judgement, setJudgement] = useState<Judgement | null>(null);
  const [judging, setJudging] = useState(false);
  const [largeFont, setLargeFont] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [recording, setRecording] = useState(false);
  const [openHit, setOpenHit] = useState<Hit | null>(null);
  const [demoNotice, setDemoNotice] = useState("");
  const demoFile = useRef<DemoFile | null>(null);

  const searcher = useRef<ReturnType<typeof buildSearcher> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(async () => {
    const o = await checkOllama();
    setStatus((s) => ({ ...s, checked: true, ollama: o.ok, chat: o.hasChat, embed: o.hasEmbed }));
  }, []);

  useEffect(() => {
    fetch(`${BASE}senior-docs.json`)
      .then((r) => r.json())
      .then((d: Doc[]) => {
        searcher.current = buildSearcher(d);
        setStatus((s) => ({ ...s, docs: d.length }));
      })
      .catch(() => setStatus((s) => ({ ...s, docs: 0 })));
    refreshStatus();
  }, [refreshStatus]);

  /* ?demo=0 / ?demo=1 로 열면 해당 예시를 바로 보여 준다. 예시 링크를 공유할 때 쓴다. */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("demo");
    if (p === "0" || p === "1") showDemo(Number(p));
    // showDemo는 busy에만 의존하고 첫 렌더에서 한 번만 실행하면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (answer && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [answer]);

  useEffect(() => {
    if (!openHit) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenHit(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openHit]);

  const ready = status.ollama && status.chat && status.embed;

  const ask = useCallback(
    async (q?: string) => {
      const queryText = (q ?? query).trim();
      if (!queryText || !searcher.current || busy) return;
      setBusy(true);
      setAsked(queryText);
      setAnswer("");
      setHits([]);
      setFeedback("");
      setJudgement(null);
      setRefused(false);
      setDemoNotice("");
      try {
        const res = await searcher.current(queryText);
        setWeak(res.weak);
        if (res.refuse) {
          setRefused(true);
          setHits([]);
          setAnswer(
            "죄송합니다. 이 질문은 안내 범위 밖이거나 자료에 근거가 없어 정확히 답변드리기 어렵습니다. 디지털배움터 이용, 보이스피싱·스미싱 예방, 무인민원발급기·정부24 이용 등에 대해 물어봐 주세요.",
          );
          return;
        }
        setHits(res.hits.slice(0, 6));
        const { system, user } = buildPrompt(queryText, res.hits, res.weak);
        abort.current = new AbortController();
        let acc = "";
        for await (const chunk of chatStream(system, user, abort.current.signal)) {
          acc += chunk;
          setAnswer(acc);
        }
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") {
          setAnswer((a) => (a ? a + "\n\n(답변 생성을 중지했습니다.)" : "답변 생성을 중지했습니다."));
        } else {
          setAnswer(`답변을 가져오지 못했습니다. ${err.message}`);
          refreshStatus();
        }
      } finally {
        setBusy(false);
        abort.current = null;
      }
    },
    [query, busy, refreshStatus],
  );

  /* 실제로 돌려 기록해 둔 결과를 그대로 화면에 올린다. 지어낸 값이 아니다. */
  const showDemo = useCallback(async (idx: number) => {
    if (busy) return;
    try {
      if (!demoFile.current) {
        demoFile.current = (await fetch(`${BASE}demo.json`).then((r) => r.json())) as DemoFile;
      }
      const c = demoFile.current.cases[idx];
      setAsked(c.question);
      setAnswer(c.answer);
      setHits(c.hits);
      setWeak(c.weak);
      setRefused(c.refuse);
      setJudgement(c.judge);
      setFeedback("");
      setDemoNotice(
        `${demoFile.current.recordedAt}에 ${demoFile.current.model}으로 실제 실행해 기록한 결과입니다. 지금 입력한 질문에 대한 답이 아닙니다.`,
      );
    } catch {
      setDemoNotice("");
      setAnswer("예시를 불러오지 못했습니다.");
    }
  }, [busy]);

  function stopAnswer() {
    abort.current?.abort();
  }

  async function runJudge() {
    if (!answer || judging) return;
    setJudging(true);
    try {
      setJudgement(await judge(asked || query, answer, hits));
    } catch (e) {
      setJudgement({
        grounded: false,
        noHalluc: false,
        cited: false,
        refusal: false,
        score: 0,
        comment: "판정을 가져오지 못했습니다. " + (e as Error).message,
      });
    } finally {
      setJudging(false);
    }
  }

  function speakAnswer() {
    if (!answer || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(stripCitations(answer));
    utterance.lang = "ko-KR";
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  }

  function toggleVoice() {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      alert("이 브라우저는 음성 입력을 지원하지 않습니다. Chrome 또는 Edge를 사용해 주세요.");
      return;
    }
    if (recording && recognitionRef.current) {
      recognitionRef.current.stop();
      setRecording(false);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "ko-KR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      setQuery(event.results[0][0].transcript);
      setRecording(false);
    };
    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }

  const rootClasses = [largeFont ? "large-font" : "", highContrast ? "high-contrast" : ""]
    .filter(Boolean)
    .join(" ");

  const missingModels = [
    !status.chat ? CHAT_MODEL : "",
    !status.embed ? EMBED_MODEL : "",
  ].filter(Boolean);

  return (
    <div className={rootClasses}>
      <div className="page">
        <header className="hero">
          <div className="hero-text">
            <p className="hero-eyebrow">공공 디지털 안내 · 근거 기반 RAG 챗봇</p>
            <h1 className="hero-title">이음이</h1>
            <p className="hero-lead">
              어르신의 일상과 디지털을 이어주는 안내자입니다. 디지털배움터, 보이스피싱·스미싱 예방,
              무인민원발급기와 정부24 이용을 공개 자료에 근거해 쉬운 말로 안내합니다.
            </p>
            <a className="hero-cta" href="#chat">
              챗봇에게 물어보기
            </a>
          </div>
          <div className="hero-visual">
            <img
              src={`${BASE}eoum-full.png`}
              alt=""
              className="hero-image"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        </header>

        <section className={`intro-grid ${HOSTED ? "is-two" : ""}`} aria-label="서비스 안내">
          <article className="intro-card">
            <h2 className="intro-title">서비스 소개</h2>
            <p className="intro-body">
              디지털배움터 이용 방법, 보이스피싱·스미싱 예방, 무인민원발급기·정부24 이용처럼 어르신이
              자주 궁금해하는 질문에 답합니다. 근거 자료 {status.docs || 15}건 안에서만 답하며,
              큰 글씨·고대비·음성 입력·읽어주기를 함께 제공합니다.
            </p>
          </article>
          <article className="intro-card">
            <h2 className="intro-title">근거 원칙</h2>
            <p className="intro-body">
              모든 답변은 공개 문서에서 뽑은 조각에 근거합니다. 자료에 없으면 지어내지 않고 없다고
              답합니다. 근거가 약하면 조심스러운 말투로 바꾸고, 안내 범위 밖이면 정중히 거절합니다.
              출처 칩을 누르면 근거가 된 원문 조각을 그대로 확인할 수 있습니다.
            </p>
          </article>
          {/* 실행 구조는 채점자에게 설명하려고 둔 카드다.
              어르신 화면에는 검색 알고리즘 이름이 필요 없으므로 실사용판에서는 감춘다. */}
          {!HOSTED && (
            <article className="intro-card">
              <h2 className="intro-title">실행 구조</h2>
              <p className="intro-body">
                자료는 미리 임베딩해 정적 파일로 두고, 검색(코사인 + BM25 + RRF)은 브라우저에서
                계산합니다. 답변 생성과 질문 임베딩은 사용자 컴퓨터의 로컬 Ollama가 맡습니다. 서버가
                대신 호출하지 않으므로 Ollama가 켜져 있어야 합니다.
              </p>
            </article>
          )}
        </section>

        <section className="chat-panel" id="chat">
          <div className="panel-head">
            <div className="panel-head-text">
              {/* 이름을 라벨로만 두면 브랜드 장식으로 넘어간다.
                  주어로 등장해야 "이 이름이 지금 나에게 답하는 상대"라는 연결이 생긴다.
                  상대가 사람인지 아닌지에 따라 믿는 방식이 달라지므로 정체도 여기서 밝힌다. */}
              <h2 className="panel-title">
                {HOSTED ? (
                  <>
                    <span className="panel-name">이음이</span>는 안내 챗봇(인공지능)이에요
                  </>
                ) : (
                  "이음이 안내 챗봇"
                )}
              </h2>
              <p className="panel-sub">
                {HOSTED
                  ? `공개된 자료 ${status.docs}건에 근거해 쉬운 말로 답해 드립니다.`
                  : `자료 ${status.docs}건 · 답변 ${CHAT_MODEL} · 임베딩 ${EMBED_MODEL}`}
              </p>
            </div>
            <span
              className={`conn-chip ${!status.checked ? "is-checking" : ready ? "is-ok" : "is-off"}`}
            >
              {!status.checked
                ? "연결 확인 중"
                : ready
                  ? HOSTED ? "안내 준비됨" : "로컬 모델 연결됨"
                  : HOSTED ? "지금은 연결할 수 없습니다" : "로컬 모델 미연결"}
            </span>
          </div>

          {/* 실사용판 — 방문자가 할 수 있는 일이 없으므로 설치 안내 대신 짧게 알린다. */}
          {status.checked && !ready && HOSTED && (
            <div className="conn-banner" role="status">
              <div className="conn-banner-head">
                <Icon name="warning" className="conn-banner-icon" />
                <div>
                  <strong className="conn-banner-title">지금은 답변을 드릴 수 없습니다.</strong>
                  <p className="conn-banner-desc">
                    안내를 만드는 컴퓨터가 잠시 꺼져 있습니다. 조금 뒤에 다시 열어 주세요.
                    아래 <b>예시 보기</b>는 지금도 보실 수 있습니다.
                  </p>
                </div>
              </div>
              <button
                className="btn-secondary"
                onClick={async () => {
                  setRechecking(true);
                  await refreshStatus();
                  setRechecking(false);
                }}
                disabled={rechecking}
              >
                {rechecking ? "확인 중..." : "다시 확인"}
              </button>
            </div>
          )}

          {/* 제출용 — 방문자 컴퓨터의 Ollama를 직접 부르는 구성이라 설치 안내가 필요하다. */}
          {status.checked && !ready && !HOSTED && (
            <div className="conn-banner" role="status">
              <div className="conn-banner-head">
                <Icon name="warning" className="conn-banner-icon" />
                <div>
                  <strong className="conn-banner-title">
                    {!status.ollama
                      ? "로컬 모델(Ollama)에 연결할 수 없습니다."
                      : `필요한 모델이 없습니다: ${missingModels.join(", ")}`}
                  </strong>
                  <p className="conn-banner-desc">
                    이 페이지는 서버가 아니라 <b>보고 계신 컴퓨터의 Ollama</b>를 직접 호출합니다.
                    아래를 순서대로 확인한 뒤 다시 확인을 눌러 주세요.
                  </p>
                </div>
              </div>

              <ol className="conn-steps">
                <li>
                  <b>브라우저 확인</b> — Safari는 이 호출을 차단합니다. Chrome 또는 Edge를 사용하고,
                  로컬 네트워크 접근을 물으면 허용을 누릅니다.
                </li>
                <li>
                  <b>Ollama 실행과 모델 준비</b>
                  <CommandBlock label="실행" command="ollama serve" />
                  <CommandBlock label="답변 모델" command={`ollama pull ${CHAT_MODEL}`} />
                  <CommandBlock label="임베딩 모델" command={`ollama pull ${EMBED_MODEL}`} />
                </li>
                <li>
                  <b>github.io에서 열었다면 CORS 허용</b> — 운영체제마다 한 번만 설정하고 Ollama를
                  재시작합니다.
                  <CommandBlock
                    label="macOS"
                    command={'launchctl setenv OLLAMA_ORIGINS "https://*.github.io"'}
                  />
                  <CommandBlock
                    label="Windows"
                    command={'setx OLLAMA_ORIGINS "https://*.github.io"'}
                  />
                  <CommandBlock
                    label="Linux"
                    command={'sudo systemctl set-environment OLLAMA_ORIGINS="https://*.github.io"'}
                  />
                  <p className="conn-note">
                    Windows는 작업 표시줄에서 Ollama를 종료한 뒤 다시 실행하고, Linux는{" "}
                    <code>sudo systemctl restart ollama</code>로 재시작합니다.
                  </p>
                  <p className="conn-note">
                    서비스로 등록하지 않고 터미널에서 직접 <code>ollama serve</code>로 띄우셨다면
                    위 명령이 듣지 않습니다. 그 프로세스를 끄고 환경변수를 붙여 다시 실행하세요.
                  </p>
                  <CommandBlock
                    label="직접 실행"
                    command={'OLLAMA_ORIGINS="https://*.github.io" ollama serve'}
                  />
                </li>
              </ol>

              <button
                className="btn-secondary"
                onClick={async () => {
                  setRechecking(true);
                  await refreshStatus();
                  setRechecking(false);
                }}
                disabled={rechecking}
              >
                {rechecking ? "확인 중..." : "다시 확인"}
              </button>
            </div>
          )}

          <div className="a11y-bar">
            <button
              className={`a11y-btn ${largeFont ? "active" : ""}`}
              onClick={() => setLargeFont(!largeFont)}
              aria-pressed={largeFont}
            >
              큰 글씨
            </button>
            <button
              className={`a11y-btn ${highContrast ? "active" : ""}`}
              onClick={() => setHighContrast(!highContrast)}
              aria-pressed={highContrast}
            >
              고대비
            </button>
          </div>

          <div className="guide-bubble">
            <img
              src={`${BASE}eoum-ui.png`}
              alt=""
              className="guide-avatar"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <div>
              <p className="guide-title">안녕하세요, 무엇을 도와드릴까요?</p>
              <p className="guide-hint">
                궁금한 점을 입력하시거나 아래 질문을 눌러 보세요. 쉽고 자세하게 알려 드립니다.
              </p>
            </div>
          </div>

          <div className="faq-section">
            <p className="section-label">자주 묻는 질문</p>
            <div className="faq-list">
              {FAQ_ITEMS.map((item) => (
                <button
                  key={item.text}
                  className="faq-card"
                  onClick={() => {
                    setQuery(item.text);
                    ask(item.text);
                  }}
                  disabled={busy}
                >
                  <span className="faq-icon">
                    <Icon name={item.icon} />
                  </span>
                  <span className="faq-text">{item.text}</span>
                </button>
              ))}
            </div>
            {/* 실사용판에서는 연결이 안 될 때만 보여 준다.
                평소에는 그냥 물어보시면 되고, 답변을 만드는 쪽이 꺼졌을 때만 대안이 된다.
                hidden 속성은 .demo-row 의 display:flex 에 덮이므로 렌더 자체를 건다. */}
            {!(HOSTED && ready) && (
              <div className="demo-row">
                <span className="demo-label">
                  {HOSTED ? "미리 만들어 둔 예시를 보시려면" : "Ollama 설치 없이 결과만 보시려면"}
                </span>
                <button className="btn-ghost" onClick={() => showDemo(0)} disabled={busy}>
                  예시: 안내한 답변
                </button>
                <button className="btn-ghost" onClick={() => showDemo(1)} disabled={busy}>
                  예시: 범위 밖 질문 거절
                </button>
              </div>
            )}
          </div>

          {!!answer && (
            <div className="chat-area" ref={chatEndRef}>
              {asked && <p className="asked-line">질문: {asked}</p>}

              {demoNotice && (
                <div className="demo-notice">
                  <Icon name="warning" />
                  <span>
                    <b>예시 화면</b> — {demoNotice}
                  </span>
                </div>
              )}

              {weak && !refused && (
                <div className="weak-warning">
                  <Icon name="warning" />
                  <span>
                    근거가 약합니다 — 검색된 자료가 질문과 완전히 맞지 않을 수 있어 조심스럽게
                    답했습니다.
                  </span>
                </div>
              )}

              <div className="chat-message">
                <img
                  src={`${BASE}eoum-ui.png`}
                  alt=""
                  className="chat-avatar"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
                <div className="chat-bubble">
                  <AnswerBody text={answer} />
                  {busy && <span className="caret" aria-hidden="true" />}
                </div>
              </div>

              {!busy && (
                <div className="chat-actions">
                  <button className="btn-ghost" onClick={speakAnswer}>
                    <Icon name="sound" />
                    <span>답변 듣기</span>
                  </button>
                </div>
              )}

              {hits.length > 0 && (
                <div className="sources-section">
                  <p className="section-label">
                    근거 자료 {hits.length}건 — 누르면 원문 조각을 볼 수 있습니다
                  </p>
                  <div className="sources-list">
                    {hits.map((h) => (
                      <button key={h.id} className="source-chip" onClick={() => setOpenHit(h)}>
                        <span className="chip-id">{h.id}</span>
                        <span className="chip-section">{h.section}</span>
                        <span className="chip-method">{METHOD_LABEL[h.method]}</span>
                        <span className="chip-score">유사도 {h.cosine.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!busy && (
                <div className="feedback-area">
                  <span className="feedback-label">이 답변이 도움이 되었나요?</span>
                  <div className="feedback-buttons">
                    <button
                      className={`feedback-btn ${feedback === "up" ? "active" : ""}`}
                      onClick={() => setFeedback("up")}
                      aria-pressed={feedback === "up"}
                    >
                      <Icon name="up" />
                      <span>도움됐어요</span>
                    </button>
                    <button
                      className={`feedback-btn ${feedback === "down" ? "active" : ""}`}
                      onClick={() => setFeedback("down")}
                      aria-pressed={feedback === "down"}
                    >
                      <Icon name="down" />
                      <span>아쉬워요</span>
                    </button>
                  </div>
                  {JUDGE_ON && (
                    <button className="btn-secondary judge-btn" onClick={runJudge} disabled={judging}>
                      {judging ? "판정 중..." : "자동판정 실행"}
                    </button>
                  )}
                </div>
              )}

              {judgement && (
                <div className="judgement-area">
                  <div className="judgement-head">
                    <span className="judgement-title">자동판정 (LLM-as-a-Judge)</span>
                    <span className="judgement-score">{judgement.score}/100</span>
                  </div>

                  <p className="judgement-state">
                    판정 대상:{" "}
                    <b>{judgement.refusal ? "거절한 답변" : "안내한 답변"}</b>
                    {judgement.refusal && " — 근거가 없어 거절한 경우이므로 아래 3개 항목은 판단에서 제외됩니다."}
                  </p>

                  <div className="judgement-flags">
                    {[
                      { key: "grounded", label: "근거 기반", value: judgement.grounded },
                      { key: "noHalluc", label: "지어내지 않음", value: judgement.noHalluc },
                      { key: "cited", label: "출처 표시", value: judgement.cited },
                    ].map((f) => (
                      <span
                        key={f.key}
                        className={`judgement-flag ${
                          judgement.refusal ? "flag-na" : f.value ? "flag-pass" : "flag-fail"
                        }`}
                      >
                        {f.label}
                        <b>{judgement.refusal ? "제외" : f.value ? "통과" : "확인 필요"}</b>
                      </span>
                    ))}
                  </div>

                  <p className="judgement-comment">{judgement.comment}</p>
                  <p className="judgement-note">
                    답변과 판정을 같은 {CHAT_MODEL} 모델이 맡으므로 독립 심사가 아닙니다. 거친 신호로
                    읽어 주세요.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="input-wrapper">
            <div className="input-area">
              <button
                className={`icon-btn ${recording ? "recording" : ""}`}
                onClick={toggleVoice}
                disabled={busy}
                title="음성으로 질문하기"
                aria-label="음성으로 질문하기"
              >
                <Icon name="mic" />
              </button>
              <input
                type="text"
                className="input-field"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="궁금한 것을 입력해 주세요"
                disabled={busy}
              />
              {busy ? (
                <button className="btn-stop" onClick={stopAnswer}>
                  <Icon name="stop" />
                  <span>중지</span>
                </button>
              ) : (
                <button className="btn-primary" onClick={() => ask()} disabled={!query.trim()}>
                  질문하기
                </button>
              )}
            </div>
            <p className="input-hint">
              글로 쓰시거나 마이크를 눌러 말씀하셔도 됩니다. 음성 입력은 Chrome·Edge에서 동작합니다.
            </p>
          </div>
        </section>

        <footer className="site-footer">
          이음이 — 어르신 디지털 안내 챗봇. 자료: 공개 문서 {status.docs}건
          {!HOSTED && ` · 답변 ${CHAT_MODEL} (Ollama, 로컬) · 임베딩 ${EMBED_MODEL}`}
        </footer>
      </div>

      {openHit && (
        <div className="modal-backdrop" onClick={() => setOpenHit(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="근거 원문 조각"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="chip-id">{openHit.id}</span>
                <span className="modal-section">{openHit.section}</span>
              </div>
              <button className="icon-btn" onClick={() => setOpenHit(null)} aria-label="닫기">
                <Icon name="close" />
              </button>
            </div>
            <p className="modal-text">{openHit.text}</p>
            <div className="modal-meta">
              <span>검색 방법: {METHOD_LABEL[openHit.method]}</span>
              <span>코사인 유사도: {openHit.cosine.toFixed(3)}</span>
              <span>BM25 점수: {openHit.bm25.toFixed(2)}</span>
            </div>
            <a className="modal-link" href={openHit.url} target="_blank" rel="noreferrer">
              <Icon name="link" />
              <span>원문 페이지 열기</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
