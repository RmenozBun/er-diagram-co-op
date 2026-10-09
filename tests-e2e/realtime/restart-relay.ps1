# Kills ONLY the relay (wrangler/workerd belonging to collaborative_tool, never vite) and restarts it. Waits for HTTP 200 on :8787.
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'collaborative_tool' -and $_.CommandLine -notmatch 'vite' -and ($_.Name -match 'workerd|node') -and ($_.CommandLine -match 'wrangler|workerd') }
foreach($p in $procs){ Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
$log = "D:\collaborative_tool\tests-e2e\results\relay-restarted.log"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","npm run relay:dev > `"$log`" 2>&1" -WorkingDirectory "D:\collaborative_tool" -WindowStyle Hidden
$t0 = Get-Date
while($true){ $c = (curl.exe -s -o NUL -w "%{http_code}" --max-time 2 http://localhost:8787/); if($c -eq "200"){ break }; Start-Sleep -Milliseconds 200; if(((Get-Date)-$t0).TotalSeconds -gt 240){ Write-Output "TIMEOUT"; exit 1 } }
Write-Output ("relay up after {0} ms" -f [int]((Get-Date)-$t0).TotalMilliseconds)
