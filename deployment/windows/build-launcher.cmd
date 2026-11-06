@echo off
REM Rebuild NexBot.exe from NexBot.cs. No SDK needed: this uses the C#
REM compiler that ships with .NET Framework, present on stock Windows.
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo ERROR: csc.exe not found. .NET Framework 4.x is required.
  exit /b 1
)
set ICON=%~dp0nexbot.ico
if not exist "%ICON%" (
  echo WARNING: nexbot.ico not found; building without an icon.
  set ICONARG=
) else (
  set ICONARG=/win32icon:"%ICON%"
)
"%CSC%" /nologo /target:winexe /out:"%~dp0NexBot.exe" %ICONARG% /r:System.Windows.Forms.dll "%~dp0NexBot.cs"
if errorlevel 1 exit /b 1
echo Built %~dp0NexBot.exe
