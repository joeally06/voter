# Kill process on port 3000 before starting server
$process = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($process) {
    Write-Host "Stopping process on port 3000 (PID: $process)..."
    Stop-Process -Id $process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Write-Host "Port 3000 freed"
} else {
    Write-Host "Port 3000 is already available"
}
