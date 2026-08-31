# 이음이 프록시 실행기 — 작업 스케줄러가 로그온할 때 이 파일을 부른다.
#
# 창을 띄우지 않고 돌기 때문에, 문제가 생기면 화면에 아무것도 안 보인다.
# 그래서 출력을 proxy.log / proxy.error.log 에 남긴다.
# 프록시가 죽어 있으면 이 두 파일을 먼저 본다.
#
# PowerShell의 *>> 리디렉션은 로그를 UTF-16으로 쓰고 한글을 깨뜨린다.
# 그래서 Start-Process 의 리디렉션을 쓴다. 이쪽은 바이트를 그대로 파일에 넣는다.
# 대신 덮어쓰기이므로, 시작 시각은 server.mjs 가 직접 찍는다.

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $here

Set-Location $repo

Start-Process -FilePath 'node' `
  -ArgumentList (Join-Path $here 'server.mjs') `
  -NoNewWindow -Wait `
  -RedirectStandardOutput (Join-Path $here 'proxy.log') `
  -RedirectStandardError  (Join-Path $here 'proxy.error.log')
