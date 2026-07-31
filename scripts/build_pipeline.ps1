$rendersDir = "$env:USERPROFILE\Documents\output\renders"

Write-Host "Waiting for current render loop to finish..."
$prev = 0
while($true) {
    $count = (Get-ChildItem $rendersDir\*.png).Count
    if($count -eq $prev -and $count -gt 150) { break }
    $prev = $count
    Start-Sleep -Seconds 10
}

Write-Host "Current loop finished. Clearing old renders..."
Remove-Item $rendersDir\*.png -Force -ErrorAction SilentlyContinue

Write-Host "Triggering new render with root motion removed..."
python c:\Projects\squad_tactics\scripts\trigger_render.py

Write-Host "Waiting for final render to finish..."
Start-Sleep -Seconds 15
$prev = 0
while($true) {
    $count = (Get-ChildItem $rendersDir\*.png).Count
    if($count -eq $prev -and $count -gt 150) { break }
    $prev = $count
    Start-Sleep -Seconds 10
}

Write-Host "Rendering complete. Generating optimized sprite sheets..."
python c:\Projects\squad_tactics\scripts\create_spritesheet.py

Write-Host "All processes completed successfully!"
