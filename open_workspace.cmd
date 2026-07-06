@echo off
REM このプロジェクトを Cursor で開く（チャット履歴が保持されます）
REM ダブルクリックで起動。Cursor の「Shell Command: Install 'cursor' command」を実行済みならそのまま動きます。
set "WS=%~dp0workspace.code-workspace"
cursor "%WS%" 2>nul || start "" "%WS%"
