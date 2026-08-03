$rendersDir = "$env:USERPROFILE\Documents\output\renders"

Write-Host "Waiting for render to finish..."
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
