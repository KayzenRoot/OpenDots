@echo off
REM Rebuild OpenDots.exe from OpenDots.cs. No SDK needed: this uses the C#
REM compiler that ships with .NET Framework, present on stock Windows.
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo ERROR: csc.exe not found. .NET Framework 4.x is required.
  exit /b 1
)
"%CSC%" /nologo /target:winexe /out:"%~dp0OpenDots.exe" /r:System.Windows.Forms.dll "%~dp0OpenDots.cs"
if errorlevel 1 exit /b 1
echo Built %~dp0OpenDots.exe
