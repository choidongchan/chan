@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PLAYON - 유튜브 레시피 자막 받기
setlocal enabledelayedexpansion

echo ========================================
echo   유튜브 레시피 자막 받기
echo ========================================
echo.
echo  영상 주소만 넣으면 자막을 받아서
echo  docs\recipes\자막 폴더에 텍스트로 저장합니다.
echo.

set "SUBDIR=docs\recipes\자막"
set "YTDLP=scripts\yt-dlp.exe"
if not exist "%SUBDIR%" mkdir "%SUBDIR%"

rem ---------- 1) 자막 받는 프로그램 준비 ----------
if not exist "%YTDLP%" (
  echo [준비] 자막 받는 프로그램을 내려받는 중입니다... 처음 한 번만 걸립니다.
  curl -L -o "%YTDLP%" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
  if not exist "%YTDLP%" (
    echo.
    echo [실패] 프로그램을 받지 못했습니다. 인터넷 연결을 확인해주세요.
    pause
    exit /b 1
  )
  echo [준비] 완료.
  echo.
) else (
  echo [준비] 자막 프로그램 최신 상태 확인 중...
  "%YTDLP%" -U >nul 2>&1
)

rem ---------- 2) 무엇을 받을지 고르기 ----------
echo ----------------------------------------
echo  [1] 영상 / 채널 / 재생목록 주소 직접 넣기
echo  [2] docs\recipes\urls.txt 에 적어둔 주소 전부 받기
echo ----------------------------------------
set /p mode=번호를 고르세요 (그냥 엔터치면 1):
if "%mode%"=="" set mode=1

if "%mode%"=="2" (
  if not exist "docs\recipes\urls.txt" (
    echo.
    echo [안내] docs\recipes\urls.txt 파일이 없습니다.
    echo        메모장으로 만들고 영상 주소를 한 줄에 하나씩 적어주세요.
    pause
    exit /b 1
  )
  set "SOURCE=-a docs\recipes\urls.txt"
  set "LIMIT="
) else (
  echo.
  set /p url=영상 또는 채널 주소를 붙여넣으세요:
  if "!url!"=="" (
    echo 주소가 없습니다. 종료합니다.
    pause
    exit /b 1
  )
  set "SOURCE=!url!"
  echo.
  set /p cnt=채널/재생목록이면 최근 몇 개까지 받을까요? (그냥 엔터치면 20개):
  if "!cnt!"=="" set cnt=20
  set "LIMIT=--playlist-end !cnt!"
)

rem ---------- 3) 자막 받기 ----------
echo.
echo [1/2] 자막을 받는 중입니다...
echo.
"%YTDLP%" --ignore-errors --no-warnings --skip-download ^
  --write-subs --write-auto-subs --sub-langs "ko.*,en.*" --convert-subs srt ^
  --windows-filenames %LIMIT% ^
  --download-archive "%SUBDIR%\_받은목록.txt" ^
  -o "%SUBDIR%\%%(upload_date)s_%%(title).80s.%%(ext)s" ^
  %SOURCE%

if errorlevel 1 (
  echo.
  echo [재시도] 로그인이 필요한 영상일 수 있어 크롬 로그인 정보로 다시 시도합니다...
  echo          ^(크롬을 완전히 종료한 뒤 진행해야 합니다^)
  echo.
  "%YTDLP%" --ignore-errors --no-warnings --skip-download ^
    --cookies-from-browser chrome ^
    --write-subs --write-auto-subs --sub-langs "ko.*,en.*" --convert-subs srt ^
    --windows-filenames %LIMIT% ^
    --download-archive "%SUBDIR%\_받은목록.txt" ^
    -o "%SUBDIR%\%%(upload_date)s_%%(title).80s.%%(ext)s" ^
    %SOURCE%
)

rem ---------- 4) 읽기 좋은 텍스트로 변환 ----------
echo.
echo [2/2] 자막을 읽기 좋은 글로 정리하는 중...
echo.
node scripts\srt2txt.mjs

echo.
echo ========================================
echo   완료!
echo ========================================
echo.
echo  받은 자막 폴더를 열어봅니다.
echo  그 다음 push.bat 을 실행해서 올리면,
echo  "자막 올렸어. 레시피 카드로 정리해줘" 라고만 하면 됩니다.
echo.
start "" "%SUBDIR%"
pause
