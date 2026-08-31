# 이음이 API 터널 실행기 — 작업 스케줄러가 로그온할 때 이 파일을 부른다.
#
# 프록시(8787) 앞단이라 같은 폴더에 둔다. 프록시와 같은 시점에 함께 떠야
# 사이에 502가 나는 구간이 안 생긴다.
#
# ⚠️ 이 노트북에서는 eoumi-api 터널만 실행한다.
#    같은 계정에 dementia-care(새록이) 터널이 있고, 그건 리눅스 데스크탑이 운영한다.
#    같은 터널을 두 기기에서 켜면 실서비스 트래픽이 갈라진다.

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe  = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$conf = "$env:USERPROFILE\.cloudflared\config.yml"

Start-Process -FilePath $exe `
  -ArgumentList @('--config', $conf, 'tunnel', 'run', 'eoumi-api') `
  -NoNewWindow -Wait `
  -RedirectStandardOutput (Join-Path $here 'tunnel.log') `
  -RedirectStandardError  (Join-Path $here 'tunnel.error.log')
