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

REM  Self-locate: this file lives at <root>\tools\pipeline\, so the project
REM  root is two levels up. Works when double-clicked from Explorer too.
pushd "%~dp0..\.."

set OUTDIR=tools\pipeline\out
set LOG=%OUTDIR%\overnight_log.txt
set REPORT=%OUTDIR%\overnight_report.txt
set BATCHES=tools\pipeline\batches
set RUNNER=tools\pipeline\run_batch.py
set EXCLUDES=tools\pipeline\excluded_assets.json

if not exist "%RUNNER%" goto NOTROOT
if not exist "%EXCLUDES%" goto NOEXCLUDES
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

>>%LOG% echo ============================================================
>>%LOG% echo OVERNIGHT REGEN START %date% %time%
>>%LOG% echo ============================================================
echo Overnight regeneration started.
echo Log:    %LOG%
echo Report: %REPORT%
echo Do not close this window.

REM --- Tilesets and characters are outside this regeneration scope.
REM --- batch1 has five non-character/non-tileset assets not repeated elsewhere.
call :RUN_ONLY batch1_probe.json "building/hut,tree/oak_large,mineral/rock_node,weapon/iron_sword_common,material/wood_log"

call :RUN batch3_nodes_flora.json
call :RUN batch4_buildings.json
call :RUN_ONLY batch5_connect.json "building/fence_post,building/fence_h,building/fence_v,building/gate_wood,building/wall_post,building/wall_h,building/wall_v,building/gate_stone"
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
python "%RUNNER%" "%BATCHES%\%~1" --force --exclude-file "%EXCLUDES%" >>%LOG% 2>&1
>>%LOG% echo BATCH %~1 END %time% exit code %errorlevel%
goto :eof

REM ------------------------------------------------------------
REM  :RUN_ONLY <batch file name> <comma-separated id list>
REM ------------------------------------------------------------
:RUN_ONLY
>>%LOG% echo.
>>%LOG% echo ------------------------------------------------------------
>>%LOG% echo BATCH %~1 (selected ids) START %time%
echo [%time%] batch %~1 (selected ids)
python "%RUNNER%" "%BATCHES%\%~1" --only "%~2" --force --exclude-file "%EXCLUDES%" >>%LOG% 2>&1
>>%LOG% echo BATCH %~1 (selected ids) END %time% exit code %errorlevel%
goto :eof

REM ------------------------------------------------------------
:NOTROOT
echo ERROR: could not find %RUNNER% - the script expected the project root at:
echo     %CD%
echo Move regen_overnight.bat back to tools\pipeline\ inside the project.
popd
pause
exit /b 1

:NOEXCLUDES
echo ERROR: could not find %EXCLUDES%
echo Create the exclusion ledger before running regeneration.
popd
pause
exit /b 1

:END
popd
endlocal
echo.
pause
