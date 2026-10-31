@echo off
echo ====================================================
echo Starting BeamDrop in Docker via Docker Compose...
echo ====================================================
docker compose up -d --build
echo.
echo Application started!
echo - Local URL: http://localhost:3055
echo.
pause
