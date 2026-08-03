Write-Host "1. Clearing old renders..."
Remove-Item "$env:USERPROFILE\Documents\output\renders\*.png" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "2. Triggering FULL render for all actions..."
python c:\Projects\squad_tactics\scripts\trigger_render.py

Write-Host "Waiting for rendering to finish (this will take 10-15 minutes at 512x512)..."
Start-Sleep -Seconds 15
$prev = 0
$noChangeCount = 0
$rendersDir = "$env:USERPROFILE\Documents\output\renders"
while($true) {
    $count = @(Get-ChildItem $rendersDir\*.png -ErrorAction SilentlyContinue).Count
    Write-Host "Rendered frames: $count"
    
    if($count -eq $prev -and $count -gt 500) { 
        $noChangeCount++
        if ($noChangeCount -ge 5) {
            break 
        }
    } else {
        $noChangeCount = 0
    }
    
    $prev = $count
    Start-Sleep -Seconds 10
}

Write-Host "3. Generating final sprite sheets..."
python c:\Projects\squad_tactics\scripts\create_spritesheet.py

Write-Host "All processes completed successfully!"
