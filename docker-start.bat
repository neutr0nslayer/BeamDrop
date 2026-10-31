@echo off
echo ====================================================
echo Starting BeamDrop in Docker via Docker Compose...
echo ====================================================
docker compose up -d --build
echo.
echo Application started!
echo - Direct Port: http://localhost:3055
echo - Domain: https://qr.fardin.com.bd
echo.
pause
