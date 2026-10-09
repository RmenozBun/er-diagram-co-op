# samples CPU% of workerd processes and node (test) for given seconds
param([int]$Seconds=25)
$ids = (Get-Process workerd).Id
$prev = @{}; foreach($i in $ids){ $prev[$i]=(Get-Process -Id $i).TotalProcessorTime.TotalSeconds }
$nodePrev=@{}
for($s=0;$s -lt $Seconds;$s+=5){
  Start-Sleep 5
  $line=""
  foreach($i in $ids){ $c=(Get-Process -Id $i -ErrorAction SilentlyContinue).TotalProcessorTime.TotalSeconds; $line += "workerd$i=" + [math]::Round(($c-$prev[$i])/5*100) + "% "; $prev[$i]=$c }
  $line += "| node-test: " + (((Get-Process node | Where-Object { $_.MainWindowTitle -eq '' } | Sort-Object CPU -Descending | Select -First 1).CPU))
  Write-Output $line
}
