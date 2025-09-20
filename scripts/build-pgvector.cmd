@echo off
setlocal

REM Visual Studio Build Tools environment
set "VSVARS=C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
call "%VSVARS%"

REM PostgreSQL root
set "PGROOT=C:\Program Files\PostgreSQL\17"

REM pgvector source directory
set "SRC=C:\temp\pgvector-0.8.1"

cd /d "%SRC%"

echo Building pgvector...
nmake /F Makefile.win
if errorlevel 1 exit /b 1

echo Installing pgvector...
nmake /F Makefile.win install
if errorlevel 1 exit /b 1

echo SUCCESS: pgvector built and installed to %PGROOT%
exit /b 0

