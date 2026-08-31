# 이음이 — 진행 상황 (Handoff)

업데이트: 2026-08-30 (UI·문서 보강 완료, 배포·푸시 대기 시점)

## 프로젝트 개요
- 메인퀘스트3: "내 도메인에서 더 잘 대답해주는 RAG 챗봇 만들기"
- 도메인: 어르신 디지털·스마트폰 이용 안내 (서비스명 이음이)
- 답변 모델: qwen3.5:2b (Ollama, 로컬, temperature 0.3)
- 임베딩 모델: embeddinggemma (Ollama, 접두어 없이 raw text, 768차원)
- 배포: GitHub Pages(정적) — 브라우저가 사용자 컴퓨터의 Ollama를 직접 호출하는 구조
- marcus-desktop 경로: ~/projects/Rag_guide_chatbot/

## 완료된 것

### 파이프라인 (실습 1~7)
1. 근거자료 15건 (`senior-docs.source.json`, SD-001~SD-015) — 최소 121자, URL·section 전부 보존
2. 임베딩: Ollama embeddinggemma 768차원 → `senior-docs.json` (`app/public/`에 사본)
3. 하이브리드 검색: `rag.ts buildSearcher()` — 코사인(top-10) + BM25 바이그램(top-5) + RRF(k=60)
4. 임계값: THRESHOLD=0.33(weak), REFUSE=0.30(거절), BM25_MIN=6.0
5. 프롬프트/스트리밍: `buildPrompt()`, `chatStream()` (stream:true, think:false, temperature 0.3), 한국어 전용 강제
6. LLM-as-a-Judge: `rag.ts judge()` — grounded/noHalluc/cited/refusal/score/comment (format:"json", temperature:0)
7. 평가: `eval.mjs`, 질문 30개(도메인내 20 / 애매 4 / 도메인밖 6), 평균 85.6

### 실험 13건 (README 표 참고)
temperature 0.3 채택, top-k 10 유지, THRESHOLD 0.33 유지, BM25_MIN 2.0→6.0 상향, 모델 2b 유지, judge 이중화(로컬 vs Gemini 3.1 Flash-Lite) 비교까지 완료.

### UI·문서 보강 (2026-08-30, 커밋 df63c1f)
- **연결 상태 칩과 미연결 배너**: 브라우저 확인 → `ollama serve`/`pull` → OS별 `OLLAMA_ORIGINS`(복사 버튼) → "다시 확인" 재시도
- **스트리밍 중지 버튼** (AbortController가 생성만 되고 취소 UI가 없던 문제 해결)
- **답변 본문 `[SD-000]` 인용 표시 복원** — 화면에서 지우던 것을 칩 형태로 강조. TTS에서만 제거
- **출처 칩에 ID·섹션·검색방법·코사인 유사도 표시**, 클릭 시 근거 원문 조각·BM25 점수·원문 링크 모달
- **판정 배지 의미 구분** — refusal:false인 정상 답변을 실패로 칠하던 문제 수정, refusal:true면 나머지 3필드는 "제외"
- **랜딩 3섹션**(서비스 소개·근거 원칙·실행 구조)
- **이미지 절대경로 404 수정** — `import.meta.env.BASE_URL` 사용
- **빌드 에러 해소** — `status` 미사용 TS6133으로 `npm run build`가 실패하던 상태를 배지 구현으로 해결
- 이모지 제거 후 인라인 SVG로 교체, 반응형 레이아웃
- README: 사용 전 준비(OS별 CORS), 화면 기능표, 청크 스키마표, 루브릭 목표값/현재값표, 실험 13건 표, **실패 사례와 원인 단계(검색/생성/판정) 표**, 음성입력이 Google 서버를 경유한다는 한계 명시
- PRD: 문제 정의 / 타겟 유저 / 핵심 기능(MVP) / 화면 구성 / 근거 자료 계획 / 배포 후 점검 기준 추가

## 검증 기록 (2026-08-30)
- `npm run build` 통과 (tsc + vite)
- 프로덕션 빌드 자산 검증(`vite preview`): index.html이 `/Rag_guide_chatbot/` base로 참조하고, js·css·senior-docs.json·eoum-full.png·eoum-ui.png·favicon.svg **6종 모두 200**
- 화면 동작: 랜딩·연결 칩·FAQ·스트리밍·중지 버튼 전환·출처 칩(`SD-004 교육 비용 의미+낱말 유사도 0.60` 형태) 확인
- Ollama를 내린 상태에서 **미연결 배너와 복구 안내가 자동 노출되는 것** 확인
- 히스토리 비밀값 점검: 키 형태 문자열 0건, `.env`·키파일 커밋 이력 없음 → 퍼블릭 전환 완료
- 배포 게시 확인(2026-08-30): index.html·assets·senior-docs.json(15건/768차원)·demo.json·이미지 전부 200
- CORS 실측: `Access-Control-Allow-Origin: https://nike1137-svg.github.io` 응답 확인

### 마무리 보완 (2026-08-30)
- **예시 미리보기**: Ollama 미설치 방문자가 미연결 배너만 보고 결과물을 전혀 확인할 수 없던 문제 해결.
  `make-demo.mjs`로 실제 파이프라인을 돌려 `app/public/demo.json`에 기록(도메인내 1건 + 도메인밖 거절 1건).
  버튼을 누르면 기존 UI(인용 표시·출처 칩·원문 모달·판정 배지)에 그대로 올라가고 예시임을 명시한다.
  지어낸 값이 아니라 실행 기록이며 eval.mjs와 같은 설정을 쓴다.
- **직접 `ollama serve` 안내**: 공식 설치 스크립트를 쓰지 않으면 `ollama.service`가 없어
  `systemctl restart ollama`가 실패한다. 배너와 README 양쪽에 대체 명령을 추가했다.
- **원격 주소를 SSH로 전환**: HTTPS라 push 때마다 비밀번호를 묻고 실패했다.
  `github_nike1137`·`github_gh_nopass` 두 키 모두 nike1137-svg로 인증되는 것을 확인하고 SSH로 바꿨다.

### 아키텍처 결정 — 브라우저 임베딩으로 되돌리지 않은 이유
참조 구현(모두콘 예시)은 임베딩을 브라우저에서 해 Ollama 모델이 1개면 되지만, 이 프로젝트는 2개가 필요하다.
전환을 검토했으나 하지 않기로 했다. 퀘스트 조건이 "미리 계산해 정적 파일로 배치해도 됩니다"로 양쪽을 허용하고,
절약되는 용량이 embeddinggemma 0.62GB뿐이며(qwen3.5:2b가 2.74GB), 무엇보다
**THRESHOLD 0.33·BM25_MIN 6.0이 embeddinggemma의 코사인 분포를 실측해 뽑은 값이라
임베딩 경로를 바꾸면 실험 기록 전체가 재측정 대상이 된다.** 대신 예시 미리보기로 접근성을 확보했다.

## 확인된 이슈·관찰
- qwen3.5:2b(중국계) → 시스템프롬프트 "한국어만" 강제, 간헐적 중국어 누출 잔존
- judge 자기모순: noHalluc=false가 30문항 중 18건이나 원문 대조 결과 실제 환각 아님 (2B 소형모델 편향, 실험 13에서 Gemini 대비 실측)
- judge가 정당한 거절(도메인밖)에 낮은 점수를 줌 — 거절 동작 자체는 6/6 정상
- `eval.mjs`·`chatStream`의 답변 생성에 비결정성이 있어 A/B 점수 차이는 노이즈를 감안해야 함

## 파일 구조
- `PRD.md` / `README.md` / `HANDOFF.md`
- `senior-docs.source.json`(원본 15개) / `senior-docs.json`(임베딩 벡터스토어)
- `embed-docs.mjs` / `check_retrieval.mjs` / `hybrid_search.mjs` / `compare_prefix.mjs`
- `eval.mjs` + `eval-results.json` (정식 평가), `eval_*.mjs` + `eval-results-*.json` (A/B 실험 산출물, 보존)
- `design-mockups/` (사례분석 12건 + 시안 3종)
- `docs/screenshots/` (실제 화면 3장) / `docs/MiMo_UI_인수인계서.md` (종료된 UI 작업 인수인계, 이력 보존용)
- `app/` (Vite + React + TS): `src/rag.ts`, `src/App.tsx`, `src/index.css`, `public/`

## 남은 작업

없음. 제출 준비 완료 상태다.

> 여기까지가 과제 제출 시점(2026-08-30)의 기록이다. 그 뒤에 어르신이 설치 없이 쓸 수 있는
> **실사용판을 별도 저장소·별도 도메인에 배포**했다. 문서 끝의
> [실사용판 배포](#실사용판-배포-2026-08-31) 절을 참고할 것.
> 제출물 자체는 그 작업에서 한 글자도 바뀌지 않았다.

- GitHub 저장소: https://github.com/nike1137-svg/Rag_guide_chatbot (퍼블릭)
- 배포 URL: https://nike1137-svg.github.io/Rag_guide_chatbot/ (게시 확인)
- 제출 폼: https://forms.gle/1BMsytrwzN5uscNA6

미확인 1건: 배포 화면에서 예시 버튼 두 개를 눌렀을 때의 렌더링을 눈으로 확인하지 못했다.
데이터 경로(demo.json 200)와 빌드 포함은 확인됨.

## 재개 방법
1. `git log --oneline`으로 최근 커밋과 이 문서의 "완료된 것" 대조
2. Ollama 실행: `ollama serve`, 모델 qwen3.5:2b / embeddinggemma
3. `cd app && npm run dev` → http://localhost:5173/Rag_guide_chatbot/
4. 평가 재현: `node eval.mjs` (30문항, `eval-results.json` 갱신)

## 반드시 지킬 원칙
- 임계값을 낮추지 말고 "신호(척도)를 높이는" 방향으로 문제 해결
- 임계값·검색 파라미터 변경 시 **eval.mjs 30문항 재검증("어긋난 질문" 0개) 필수**
- A/B 실험은 원본 스크립트 보존 후 사본으로 실행, "한 바퀴에 변수 하나", 산출물은 커밋
- 파일 덮어쓰기 전 백업, 오류 시 즉시 삭제 → 확인 → 재작업
- 새 API·패키지 도입 전 유료 플랜·한도·자동과금 확인 필수 (현재까지 전부 로컬/무료, Gemini judge 실험만 무료 티어 사용)
- **기준선(대조군) 산출물도 실험군과 똑같이 별도 파일로 남길 것.** 이번에 `eval-results.json`을
  재실행으로 덮어써서 A/B 표가 비교한 80점짜리 대조군을 잃었다. 파일명만 다르게 해도 막을 수 있었다
- **평가 결과 JSON 맨 앞에 설정 스탬프를 넣을 것** (K_VEC·THRESHOLD·BM25_MIN·temperature·모델명·실행일시).
  현재 산출물은 파일 이름으로만 조건을 구분할 수 있어 재현성이 약하다
- **`eval_*.mjs` 9개는 165줄 중 1~3줄만 다른 복붙본이다.** 상수 하나를 바꾸려면 열 곳을 고쳐야 하고
  다음 실험에서 조용히 어긋난다. 다음에는 `node eval.mjs --topk=5 --out=...` 형태의 인자 방식으로 통합할 것
- **히스토리를 재작성했으면 문서의 커밋 해시 참조를 반드시 다시 확인할 것.**
  공동저자 표기를 지우며 `filter-branch`를 돌린 뒤 HANDOFF의 해시가 도달 불가 상태로 남아 있었다

---

# 실사용판 배포 (2026-08-31)

과제 제출물은 그대로 두고, 어르신이 아무것도 설치하지 않고 쓸 수 있는 판을
별도 도메인에 배포했다. 이 절부터는 그 작업 기록이다.

## 저장소가 둘이다

| | 저장소 | 배포 주소 | 상태 |
|---|---|---|---|
| 제출용 | `nike1137-svg/Rag_guide_chatbot` | https://nike1137-svg.github.io/Rag_guide_chatbot/ | **동결.** main `df10b1d`, gh-pages `c3b5463` |
| 실사용판 | `nike1137-svg/Rag_guide_chatbot-live` | https://chat.dodami-ai.com | 작업 중 |

제출을 이미 마쳤고 "제출물은 어떤 경우에도 수정 금지"가 제1제약이라, 같은 저장소의
브랜치가 아니라 **저장소 자체를 나눴다.** 브랜치로 하면 `git push` 오타 한 번이나
`npm run deploy` 한 번으로 제출물에 닿는다. 저장소가 다르면 그 경로가 물리적으로 없다.

노트북의 작업 폴더 `C:\Users\nike1\Rag_guide_chatbot` 은 **live 저장소만** 원격으로
가지고 있다. 소스를 꺼낸 직후 제출 저장소 remote 를 지웠고, `gh-pages` 브랜치는
아예 받아오지 않았다. 회귀 검증이 필요하면 임시 폴더에 따로 clone 해서 쓰고 지운다.

기준선은 작업 전후로 매번 확인했고 끝까지 변하지 않았다.
게시된 번들 해시 `index-Bewr_LhS.js` 는 제출 저장소를 새로 clone 해 빌드한 결과와 같다.

## 구성

```
어르신 스마트폰 (설치 없음)
   ↓ HTTPS
chat.dodami-ai.com   Cloudflare Pages — 화면 + 검색(코사인·BM25·RRF)
   ↓ fetch
api.dodami-ai.com    Cloudflare Tunnel (터널 이름 eoumi-api)
   ↓
윈도우 노트북 TAKEDA : 보호 프록시 8787 → Ollama 11434
```

검색은 브라우저에서 끝내고, 임베딩과 생성만 노트북이 맡는다. 원래 설계 그대로다.

## 한 소스에서 두 벌

`app/scripts/build.mjs` 가 가른다. 먼저 `VITE_*` 를 전부 지우고 필요한 값만 다시 넣는다.
PowerShell 의 `$env:` 가 창에 남아 두 빌드가 섞이는 사고를 막기 위한 것이다.

```
npm run build:submit   # 환경변수 없이 빌드. 제출용 동작 그대로
npm run build:live     # app/.env.live 를 읽는다 (커밋 대상 아님)
```

| 환경변수 | 기본값(제출용) | 실사용판 |
|---|---|---|
| `VITE_OLLAMA_URL` | `http://localhost:11434` | `https://api.dodami-ai.com` |
| `VITE_BASE` | `/Rag_guide_chatbot/` | `/` |
| `VITE_HEALTH_PATH` | `/api/tags` | `/api/health` |
| `VITE_JUDGE` | 켜짐 | `off` |
| `VITE_CONTEXT_K` | `6` | `3` |
| `VITE_KEEP_ALIVE` | 없음(Ollama 기본 5분) | `30m` |
| `VITE_HOSTED` | 없음 | `1` (문구 분기) |

검색 파라미터(THRESHOLD 0.33 / REFUSE 0.30 / BM25_MIN 6.0 / K_VEC 10 / K_BM25 5 / RRF_K 60)는
양쪽이 같다. 화면 출처 칩 개수도 6으로 같다 — 출처 칩은 검색이 무엇을 왜 골랐는지 보여주는
장치이고, 모델이 실제로 근거로 삼은 것은 본문의 `[SD-000]` 인용으로 따로 드러난다.

`app/package.json` 의 `deploy: gh-pages -d dist` 는 제거했다. live 저장소는 Cloudflare Pages 로
배포하고, 제출본은 이미 동결됐다.

## 보호 프록시 (`proxy/server.mjs`)

Ollama API 에는 인증이 없다. 그대로 터널에 노출하면 주소를 아는 누구나 모델을 지우거나
받을 수 있다. 그래서 프록시만 밖으로 내보낸다. 외부 패키지 없이 Node 내장 모듈만 쓰고
`127.0.0.1` 에만 바인딩한다.

| 항목 | 값 |
|---|---|
| 포트 | 8787 |
| 통과 경로 | `POST /api/chat`, `POST /api/embed`, `GET /api/health` — 이 셋뿐 |
| 그 밖의 경로 | 404 (`/api/tags` `/api/pull` `/api/delete` 가 여기서 막힌다) |
| 모델 | `qwen3.5:2b` / `embeddinggemma` 만 통과. 그 외 400 |
| 본문 상한 | 16 KB, 초과 시 413 |
| 레이트리밋 | IP당 분당 30요청 |
| 허용 오리진 | `proxy/proxy.env` 의 `ALLOWED_ORIGINS` (커밋 대상 아님) |
| 로그 | `proxy/proxy.log`, `proxy/proxy.error.log` |

`GET /api/health` 는 프록시가 내부적으로 Ollama `/api/tags` 를 확인해 `{ok, hasChat, hasEmbed}`
만 돌려준다. 모델 목록은 내보내지 않는다. 화면의 연결 상태 칩이 이걸 쓴다.

레이트리밋은 `CF-Connecting-IP` 를 본다. cloudflared 가 노트북 안에서 프록시에 붙기 때문에
`remoteAddress` 를 쓰면 모든 외부 사용자가 `127.0.0.1` 하나로 보여 "IP당 30회"가
"전체 30회"가 된다. 단 그 헤더는 **루프백에서 들어온 연결일 때만** 믿는다.

한도 30은 정상 사용 제한이 아니라 자동화 남용 차단용이다. 질문 1건이
embed 1 + chat 1 이고, Ollama 가 요청을 순차 처리하며 한 건에 1분 안팎이 걸려
물리적으로 그만큼 받지도 못한다.

## 터널

| 항목 | 값 |
|---|---|
| 터널 이름 | `eoumi-api` |
| 설정 | `%USERPROFILE%\.cloudflared\config.yml` |
| 자격증명 | `%USERPROFILE%\.cloudflared\<터널ID>.json` — **저장소 밖. 커밋하지 않는다** |
| ingress | `api.dodami-ai.com` → `http://localhost:8787` 하나뿐 |

**같은 Cloudflare 계정에 `dementia-care`(새록이)와 `dodami-marcus` 터널이 따로 있다.**
새록이는 리눅스 데스크탑이 운영하는 실서비스다. 이 노트북에서는 `eoumi-api` 만 실행한다.
같은 터널을 두 기기가 켜면 트래픽이 갈라진다. `care.` DNS 레코드는 손대지 않았다
(작업 전후 모두 302로 동일함을 확인했다).

## 상시 실행 — 작업 스케줄러 두 개

프록시와 터널을 **같은 방식**으로 등록했다. 둘이 같은 시점에 떠야 그 사이에 502가
나는 구간이 안 생긴다. 등록에는 관리자 권한이 필요하다.

```powershell
$tr = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\nike1\Rag_guide_chatbot\proxy\start-proxy.ps1"'
schtasks /create /tn "eoumi-proxy" /tr $tr /sc onlogon /rl LIMITED /f

$tr = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\nike1\Rag_guide_chatbot\proxy\start-tunnel.ps1"'
schtasks /create /tn "eoumi-tunnel" /tr $tr /sc onlogon /rl LIMITED /f
```

`cloudflared service install` 은 쓰지 않았다. 토큰 없이 설치하면 LocalSystem 계정의 설정
디렉터리에서 자격증명을 찾는데 그 디렉터리가 만들어지지 않아, 서비스가 떠 있어도 터널에
붙지 못하고 502가 났다. 서비스 인자에 `tunnel run` 도 config 경로도 들어가지 않은 상태였다.

## 노트북 전원 설정

교류 전원일 때만 아래를 0으로 두었다. **배터리 설정은 건드리지 않았다.**

| 항목 | 값 |
|---|---|
| 절전(대기) / 화면 끄기 / 최대 절전 | 0 = 안 함 |
| 덮개 닫기 | 아무것도 안 함 |

윈도우 11은 Modern Standby라 `powercfg /change` 만으로는 덮개 닫기를 못 막는다.
덮개 설정은 기본적으로 숨겨져 있어 먼저 드러내야 했다.

```powershell
$LID = '5ca83367-6e45-459f-a27b-476b1d01c936'
powercfg -attributes SUB_BUTTONS $LID -ATTRIB_HIDE
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS $LID 0
powercfg /setactive SCHEME_CURRENT
```

## 응답 시간 실측 (i5-10210U 4코어, GPU 가속 없음)

첫 글자까지 걸리는 시간은 **프롬프트 길이에 거의 정비례**한다. 모델이 느린 게 아니라
CPU가 긴 프롬프트를 읽는 속도가 느린 것이다.

| 근거 개수 | 프롬프트 | 첫 글자까지 | 전체 |
|---|---|---|---|
| 0건 | 77자 | 2.6초 | 19.5초 |
| **3건 (실사용판)** | 약 750자 | **15~25초** | 55~87초 |
| 6건 (제출용) | 약 1400자 | 38~48초 | 53~97초 |

- **같은 질문을 반복하면 Ollama 프롬프트 캐시로 0.4초까지 떨어진다. 측정할 때 속지 말 것.**
  서로 다른 질문·다른 근거 조합으로 재야 한다.
- **터널 자체의 부담은 사실상 0이다.** 같은 프롬프트를 로컬 직접과 터널 경유로 번갈아
  재보니 차이가 캐시 적중 여부에서만 났다.
- Cloudflare 무료 구간은 첫 응답까지 100초를 넘기면 524로 끊는다. 혼자 쓸 때는 여유가
  있지만, Ollama가 순차 처리라 **두 사람이 겹치면 뒷사람이 100초를 넘길 수 있다.**
  대책(프록시가 응답 헤더를 먼저 흘려보내기)은 아직 넣지 않았다. 실제로 끊기는 것을
  보고 넣기로 했다. 필요하면 30줄이면 된다.

## 배포

Cloudflare Pages 프로젝트 `eoumi`, wrangler 직접 업로드.

```
cd app && npm run build:live
cd .. && npx wrangler pages deploy app/dist --project-name=eoumi --branch=main
```

커스텀 도메인 `chat.dodami-ai.com` 은 wrangler에 명령이 없어 대시보드에서 붙였다
(Workers 및 Pages → eoumi → 사용자 설정 도메인). 활성화까지 1~3분 걸렸다.
`.wrangler/` 는 계정 ID가 담기므로 커밋하지 않는다.

## 살아 있는지 확인하는 법

```powershell
curl.exe -s http://localhost:8787/api/health          # 프록시
curl.exe -s https://api.dodami-ai.com/api/health      # 터널까지
curl.exe -s -o NUL -w "%{http_code}`n" https://chat.dodami-ai.com/   # 화면
```

`health` 가 `{"ok":true,...}` 이고 화면이 200이면 정상이다.
둘 다 502면 프록시가 죽었거나 터널이 안 떠 있는 것이다. `proxy/*.log` 를 본다.

## 다시 손댈 때 주의할 것

- **제출 저장소는 어떤 경우에도 건드리지 않는다.** 작업 폴더에 그 remote 가 없는 것이
  안전장치다. 실수로 다시 추가하지 말 것.
- 프록시를 고쳤으면 **curl 검증만으로 충분하지 않다.** curl은 CORS 프리플라이트를
  보내지 않아, 검증을 전부 통과하면서 브라우저에서만 죽는 구멍이 생긴다.
  반드시 실제 브라우저로 `OPTIONS` 가 204를 받는지 확인한다.
- 허용 오리진을 바꿨으면 프록시를 다시 띄워야 반영된다
  (`schtasks /end` → `schtasks /run /tn "eoumi-proxy"`).
- PowerShell 에서 `curl` 은 `Invoke-WebRequest` 별칭이다. 반드시 `curl.exe`.
  본문에 한글을 넣으면 인용이 깨지므로 파일에 적어 `--data-binary "@파일"` 로 보낸다.
