@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PLAYON 서버
echo ========================================
echo   PLAYON - PC방 관리 프로그램
echo ========================================
echo.
echo [1/2] 최신 버전 받는 중...
git pull
echo.
echo [2/2] 서버 시작 중... 잠시만 기다려주세요
echo    브라우저에서 http://localhost:8080 접속하세요
echo    종료하려면 이 창을 닫으면 됩니다
echo.
npm start
echo.
echo 서버가 종료되었습니다.
pause
