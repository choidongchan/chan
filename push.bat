@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PLAYON 올리기(배포)
echo ========================================
echo   PLAYON - 수정사항 올리기(자동배포)
echo ========================================
echo.
echo [1/4] 최신 버전과 합치는 중...
git pull --no-edit
echo.
set /p msg=변경 내용을 한 줄로 적어주세요 (예: 좌석색상 변경):
if "%msg%"=="" set msg=update
echo.
echo [2/4] 변경사항 담는 중...
git add -A
echo [3/4] 저장(commit) 중...
git commit -m "%msg%"
echo [4/4] 올리는(push) 중...
git push
echo.
echo ========================================
echo   완료! 잠시 뒤 인터넷에 자동 반영됩니다.
echo ========================================
pause
