Write-Host "1. Importing FBX files..."
python c:\Projects\squad_tactics\scripts\import_fbx.py
Start-Sleep -Seconds 10

Write-Host "2. Removing root motion..."
python c:\Projects\squad_tactics\scripts\remove_root_motion.py
Start-Sleep -Seconds 3

Write-Host "3. Reparenting lights..."
python c:\Projects\squad_tactics\scripts\reparent_lights.py
Start-Sleep -Seconds 3

Write-Host "4. Clearing old renders..."
Remove-Item "$env:USERPROFILE\Documents\output\renders\*.png" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "5. Triggering render..."
python c:\Projects\squad_tactics\scripts\trigger_render.py

Write-Host "Waiting for rendering to finish (this will take a few minutes)..."
Start-Sleep -Seconds 30
$prev = 0
$rendersDir = "$env:USERPROFILE\Documents\output\renders"
while($true) {
    $count = @(Get-ChildItem $rendersDir\*.png -ErrorAction SilentlyContinue).Count
    Write-Host "Rendered frames: $count"
    if($count -eq $prev -and $count -gt 200) { break }
    $prev = $count
    Start-Sleep -Seconds 15
}

Write-Host "6. Generating optimized sprite sheets..."
python c:\Projects\squad_tactics\scripts\create_spritesheet.py

Write-Host "All processes completed successfully!"
