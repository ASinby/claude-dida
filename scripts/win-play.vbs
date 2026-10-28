Option Explicit

' Hidden launcher: wscript.exe is a GUI-subsystem process, so it has no console
' window of its own and survives the parent exiting. It then starts PowerShell
' with SW_HIDE (Run's second argument = 0).
'
' Usage: wscript //nologo //B win-play.vbs <file> [volume] [wait 0|1]

Dim sh, fso, ps1, file, vol, waitFlag

If WScript.Arguments.Count < 1 Then WScript.Quit 2

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

file = WScript.Arguments(0)
' The path is spliced into a command line; a stray quote would break the structure.
file = Replace(file, """", "")

vol = "0.7"
If WScript.Arguments.Count > 1 Then vol = WScript.Arguments(1)

waitFlag = False
If WScript.Arguments.Count > 2 Then waitFlag = (WScript.Arguments(2) = "1")

ps1 = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "win-play.ps1")
If Not fso.FileExists(ps1) Then WScript.Quit 3

sh.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass" & _
       " -WindowStyle Hidden -File """ & ps1 & """ """ & file & """ " & vol, _
       0, waitFlag
