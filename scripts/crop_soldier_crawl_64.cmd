@echo off
REM 匍匐スプライト用: soldier_crawl.png の上 2048x2048 を soldier_crawl_64.png に切り出す
REM プロジェクトルートで実行すること（この .cmd は scripts フォルダ内にある想定）
cd /d "%~dp0.."
python scripts/crop_soldier_crawl_64.py
if errorlevel 1 pause
