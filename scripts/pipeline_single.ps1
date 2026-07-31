Write-Host "1. Clearing test renders..."
Remove-Item "$env:USERPROFILE\Documents\output\renders_test\*.png" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "2. Triggering render for Kneel.Dying..."
python c:\Projects\squad_tactics\scripts\trigger_single.py

Write-Host "Waiting for rendering to finish..."
Start-Sleep -Seconds 10
$prev = 0
$rendersDir = "$env:USERPROFILE\Documents\output\renders_test"
while($true) {
    $count = @(Get-ChildItem $rendersDir\*.png -ErrorAction SilentlyContinue).Count
    Write-Host "Rendered frames: $count"
    if($count -eq $prev -and $count -gt 0) { break }
    $prev = $count
    Start-Sleep -Seconds 10
}

Write-Host "3. Generating test sprite sheet..."
python c:\Projects\squad_tactics\scripts\create_spritesheet_test.py

Write-Host "Kneel.Dying test completed!"
