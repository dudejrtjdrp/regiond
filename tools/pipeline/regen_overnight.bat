@echo off
REM ============================================================
REM  Toji asset pipeline - overnight full regeneration
REM  Run from the PROJECT ROOT:
REM      tools\pipeline\regen_overnight.bat
REM  ComfyUI must already be running at http://127.0.0.1:8188
REM ============================================================
REM  Notes for future editors:
REM   - redirects are written BEFORE echo ( >>%LOG% echo ... ) because
REM     %time% ends in a digit and "echo ...%time%>>file" would be parsed
REM     as a numbered-handle redirect by cmd.
REM   - the --only list is quoted because cmd splits arguments on commas.
REM ============================================================

setlocal
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

set OUTDIR=tools\pipeline\out
set LOG=%OUTDIR%\overnight_log.txt
set REPORT=%OUTDIR%\overnight_report.txt
set BATCHES=tools\pipeline\batches
set RUNNER=tools\pipeline\run_batch.py

if not exist "%RUNNER%" goto NOTROOT
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

>>%LOG% echo ============================================================
>>%LOG% echo OVERNIGHT REGEN START %date% %time%
>>%LOG% echo ============================================================
echo Overnight regeneration started.
echo Log:    %LOG%
echo Report: %REPORT%
echo Do not close this window.

REM --- batch1: keep the approved probes (wolf, hut, iron_sword_common, wood_log)
REM     and redo only the two known failures.
>>%LOG% echo.
>>%LOG% echo ------------------------------------------------------------
>>%LOG% echo STEP batch1 probe partial START %time%
echo [%time%] batch1 probe (oak_large, grass)
python "%RUNNER%" "%BATCHES%\batch1_probe.json" --only "tree/oak_large,tileset/grass" --force >>%LOG% 2>&1
>>%LOG% echo STEP batch1 probe partial END %time% exit code %errorlevel%

call :RUN batch2_terrain.json
call :RUN batch3_nodes_flora.json
call :RUN batch4_buildings.json
call :RUN batch5_connect.json
call :RUN batch6_items.json
call :RUN batch7_equipment.json
call :RUN batch8_ui.json
call :RUN batch9_effects.json

>>%LOG% echo.
>>%LOG% echo ------------------------------------------------------------
>>%LOG% echo REQUALIFY START %time%
echo [%time%] requalify
python tools\pipeline\requalify.py >"%REPORT%" 2>&1
>>%LOG% echo REQUALIFY END %time% exit code %errorlevel%
type "%REPORT%" >>%LOG%

>>%LOG% echo.
>>%LOG% echo ============================================================
>>%LOG% echo OVERNIGHT REGEN END %date% %time%
>>%LOG% echo ============================================================
echo.
echo Done. Open %REPORT% for the PASS/WARNING/FAIL table
echo and the copy-paste commands to redo any FAIL assets.
goto END

REM ------------------------------------------------------------
REM  :RUN <batch file name>   - never aborts the run on failure
REM ------------------------------------------------------------
:RUN
>>%LOG% echo.
>>%LOG% echo ------------------------------------------------------------
>>%LOG% echo BATCH %~1 START %time%
echo [%time%] batch %~1
python "%RUNNER%" "%BATCHES%\%~1" --force >>%LOG% 2>&1
>>%LOG% echo BATCH %~1 END %time% exit code %errorlevel%
goto :eof

REM ------------------------------------------------------------
:NOTROOT
echo ERROR: run this from the project root, not from tools\pipeline.
echo     cd C:\path\to\toji
echo     tools\pipeline\regen_overnight.bat
exit /b 1

:END
endlocal
