# new ブランチに自動で add / commit / push するスクリプト
# 使い方: .\push-new.ps1 [コミットメッセージ]
# 例: .\push-new.ps1
# 例: .\push-new.ps1 "fix: 〇〇を修正"

$repo = $PSScriptRoot
$msg = if ($args.Count -gt 0) { $args -join " " } else { "update: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }

Set-Location $repo
$status = git status --porcelain
if (-not $status) {
    Write-Host "変更がありません。" -ForegroundColor Yellow
    exit 0
}
git add -A
git status
git commit -m $msg
git push origin new
Write-Host "`n完了: origin/new にプッシュしました。" -ForegroundColor Green
