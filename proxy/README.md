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

## 설정 파일

`proxy.env.example` 을 `proxy.env` 로 복사해서 값을 채운다. `proxy.env` 는 커밋하지 않는다.
서버가 시작할 때 이 파일을 읽어 **비어 있는 값만** 채운다. 환경변수가 이미 있으면 그쪽이 이긴다.

배포 후에는 `ALLOWED_ORIGINS` 에 실사용판 주소를 추가하고 프록시를 다시 띄운다.

## 상시 실행 (작업 스케줄러)

`start-proxy.ps1` 이 프록시를 창 없이 띄운다. 작업 스케줄러가 로그온할 때 이 파일을 부른다.
등록은 **관리자 PowerShell**에서 한 번만 하면 된다.

```powershell
$tr = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\nike1\Rag_guide_chatbot\proxy\start-proxy.ps1"'
schtasks /create /tn "eoumi-proxy" /tr $tr /sc onlogon /rl LIMITED /f
```

| 명령 | 하는 일 |
|---|---|
| `schtasks /run /tn "eoumi-proxy"` | 지금 바로 띄운다 |
| `schtasks /end /tn "eoumi-proxy"` | 내린다 |
| `schtasks /query /tn "eoumi-proxy"` | 상태를 본다 |
| `schtasks /delete /tn "eoumi-proxy" /f` | 등록을 지운다 |

창이 없으므로 화면에는 아무것도 안 보인다. 살아 있는지는 이렇게 확인한다.

```powershell
curl.exe -s http://localhost:8787/api/health
```

문제가 생기면 `proxy/proxy.log` 와 `proxy/proxy.error.log` 를 본다.

> PowerShell의 `*>>` 리디렉션은 로그를 UTF-16으로 써서 한글을 깨뜨린다.
> 그래서 실행기는 `Start-Process` 의 리디렉션을 쓴다. 이쪽은 바이트를 그대로 넣는다.
> 대신 덮어쓰기라서, 시작 시각은 `server.mjs` 가 직접 찍는다.

## Cloudflare Tunnel

프록시(8787)를 `api.dodami-ai.com` 으로 내보낸다. 공인 IP나 포트포워딩이 필요 없고,
노트북이 밖으로 나가는 연결이라 네트워크가 바뀌어도(교육장 ↔ 집) 자동으로 다시 붙는다.

| 항목 | 값 |
|---|---|
| 터널 이름 | `eoumi-api` |
| 설정 | `%USERPROFILE%\.cloudflared\config.yml` |
| 자격증명 | `%USERPROFILE%\.cloudflared\<터널ID>.json` — **저장소 밖. 절대 커밋하지 않는다** |
| 실행기 | `proxy/start-tunnel.ps1` |
| 작업 이름 | `eoumi-tunnel` (로그온 시 시작) |
| 로그 | `proxy/tunnel.log`, `proxy/tunnel.error.log` (cloudflared는 stderr로 쓴다) |

### ⚠️ 같은 계정에 다른 터널이 있다

이 Cloudflare 계정에는 `dementia-care`(새록이)와 `dodami-marcus` 터널이 따로 있고,
새록이는 **리눅스 데스크탑이 운영하는 실서비스**다.

- 이 노트북에서는 **`eoumi-api` 터널만** 실행한다
- 다른 터널을 이 노트북에서 `run` 하지 않는다. 같은 터널을 두 기기가 켜면 트래픽이 갈라진다
- `care.dodami-ai.com` DNS 레코드는 손대지 않는다

### 등록

관리자 PowerShell에서 한 번만.

```powershell
$tr = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\nike1\Rag_guide_chatbot\proxy\start-tunnel.ps1"'
schtasks /create /tn "eoumi-tunnel" /tr $tr /sc onlogon /rl LIMITED /f
```

`cloudflared service install` 은 쓰지 않는다. 토큰 없이 설치하면 LocalSystem 계정의
설정 디렉터리에서 자격증명을 찾는데 그 디렉터리가 만들어지지 않아, 서비스가 떠 있어도
터널에 붙지 못하고 502가 난다(2026-08-31 실제로 겪음). 프록시와 같은 방식으로 맞추면
둘이 같은 시점에 떠서 그 사이에 502가 나는 구간도 없어진다.

### 외부에서 확인

```powershell
curl.exe -s https://api.dodami-ai.com/api/health
curl.exe -s -o NUL -w "tags=%{http_code}`n" https://api.dodami-ai.com/api/tags
```

`health` 가 `{"ok":true,...}` 이고 `tags=404` 여야 한다.
`tags` 가 200이면 프록시를 거치지 않는다는 뜻이므로 즉시 터널을 내리고 설정을 다시 잡는다.
둘 다 502면 프록시가 죽었거나 터널이 안 떠 있는 것이다.

## 노트북 전원 설정

노트북이 잠들면 서비스가 끊긴다. 교류 전원일 때만 아래를 0으로 둔다. **배터리는 건드리지 않는다.**

| 항목 | 값 |
|---|---|
| 절전(대기) | 0 = 안 함 |
| 화면 끄기 | 0 = 안 함 |
| 최대 절전 | 0 = 안 함 |
| 덮개 닫기 | 아무것도 안 함 |

윈도우 11은 Modern Standby라 `powercfg /change` 만으로는 덮개 닫기를 못 막는다.
덮개 설정은 기본적으로 숨겨져 있어 먼저 드러내야 한다.

```powershell
$LID = '5ca83367-6e45-459f-a27b-476b1d01c936'
powercfg -attributes SUB_BUTTONS $LID -ATTRIB_HIDE
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS $LID 0
powercfg /setactive SCHEME_CURRENT
```

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
