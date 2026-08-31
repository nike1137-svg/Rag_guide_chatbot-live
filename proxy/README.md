# 보호 프록시

Ollama API에는 인증이 없다. 주소만 알면 누구나 모델을 지우거나 받을 수 있고,
무제한으로 생성을 돌릴 수도 있다. 그래서 Ollama(11434)를 터널에 직접 노출하지 않고
이 프록시(8787)만 밖으로 내보낸다.

## 실행

```
node proxy/server.mjs
```

환경변수로 조정한다. 전부 기본값이 있으므로 그냥 실행해도 로컬 개발에는 맞는다.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PROXY_PORT` | `8787` | 프록시가 듣는 포트 |
| `OLLAMA_URL` | `http://localhost:11434` | 뒤에 있는 Ollama |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | 쉼표로 구분. `*` 는 쓰지 않는다 |
| `RATE_PER_MIN` | `30` | IP당 분당 요청 수 |
| `MAX_BODY` | `16384` | 요청 본문 상한(byte) |

프록시는 `127.0.0.1` 에만 바인딩한다. 같은 공유기의 다른 기기에서도 직접 보이지 않는다.
밖에서 들어오는 길은 Cloudflare Tunnel 하나뿐이다.

## 통과시키는 경로

| 경로 | 하는 일 |
|---|---|
| `POST /api/chat` | 답변 생성. 스트리밍을 모아두지 않고 그대로 흘린다 |
| `POST /api/embed` | 질문 임베딩 |
| `GET /api/health` | 연결 확인. `{ok, hasChat, hasEmbed}` 만 준다 |
| `OPTIONS` | CORS 프리플라이트. 204 |

나머지는 전부 404다. `/api/tags`, `/api/delete`, `/api/pull` 이 여기서 막힌다.

## 주의해서 볼 곳 두 군데

**프리플라이트(OPTIONS)** — 앱은 `Content-Type: application/json` 으로 POST 하므로
브라우저가 본 요청 전에 OPTIONS를 먼저 보낸다. 이걸 404로 막으면 **모든 요청이
브라우저 단계에서 차단된다.** 그런데 `curl` 은 프리플라이트를 보내지 않아서,
curl 검증만 하면 전부 통과하는데 브라우저에서만 죽는다. 반드시 브라우저로도 확인할 것.

**레이트리밋의 IP** — cloudflared는 노트북 안에서 이 프록시에 붙는다. 그래서
`req.socket.remoteAddress` 를 쓰면 모든 외부 사용자가 `127.0.0.1` 하나로 보이고,
"IP당 30회" 가 "전체 30회" 로 바뀐다. `CF-Connecting-IP` 헤더를 쓰되,
**루프백에서 들어온 연결일 때만** 그 헤더를 믿는다. 아니면 헤더를 위조해 우회할 수 있다.

## 검증

```powershell
# 허용
curl.exe -s http://localhost:8787/api/health

# 프리플라이트 — 204 여야 한다
curl.exe -s -o NUL -w "preflight=%{http_code}`n" -X OPTIONS http://localhost:8787/api/chat -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"

# 차단 — 404 404 400 이어야 한다
curl.exe -s -o NUL -w "tags=%{http_code}`n" http://localhost:8787/api/tags
curl.exe -s -o NUL -w "delete=%{http_code}`n" -X DELETE http://localhost:8787/api/delete
curl.exe -s -o NUL -w "model=%{http_code}`n" -X POST http://localhost:8787/api/chat -H "Content-Type: application/json" -d "{\"model\":\"llama3\",\"messages\":[]}"
```

PowerShell에서 `curl` 은 `Invoke-WebRequest` 별칭이다. 반드시 `curl.exe` 로 쓴다.
그리고 본문에 한글을 넣으면 PowerShell이 인용을 망가뜨리므로, 한글이 필요하면
파일에 적어 `--data-binary "@파일"` 로 보낸다.
