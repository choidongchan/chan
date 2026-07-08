@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PLAYON 개발모드(자동배포)
echo ========================================
echo   PLAYON 개발 모드 - 저장하면 자동 배포
echo ========================================
echo.
echo 최신 버전 받는 중...
git pull
echo.
echo [1] 자동배포 감시 시작 (별도 창)
start "PLAYON 자동배포 감시" cmd /k node watch.mjs
echo.
echo [2] 로컬 미리보기 서버 시작
echo     - 미리보기: http://localhost:8080
echo     - 이제 VS Code로 코드를 수정하고 저장만 하면 자동으로 올라갑니다
echo     - 종료: 이 창과 감시 창을 닫으세요
echo.
npm start
