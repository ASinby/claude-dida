param([string]$File, [double]$Volume = 0.7)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$player.Volume = [Math]::Min(1, [Math]::Max(0, $Volume))
$player.Open([uri]$File)
$player.Play()

# NaturalDuration needs MediaOpened; cap the wait so a bad file cannot hang us.
$guard = 0
while (-not $player.NaturalDuration.HasTimeSpan -and $guard -lt 250) {
  Start-Sleep -Milliseconds 10
  $guard++
}
$ms = if ($player.NaturalDuration.HasTimeSpan) { $player.NaturalDuration.TimeSpan.TotalMilliseconds } else { 800 }

Start-Sleep -Milliseconds ([int]$ms + 150)
$player.Close()
