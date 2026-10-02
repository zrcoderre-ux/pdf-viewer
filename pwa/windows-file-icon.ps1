# Show the PDF Viewer logo on the files the app opens, in Windows File Explorer.
#
# When Chrome installs a web app that handles files, it registers each file
# type the app opens (Software\Classes\<ProgId>) with an EMPTY DefaultIcon, so
# a .pdf whose default app is PDF Viewer shows Windows' blank page with a
# folded corner. The app's icon is already on disk, the .ico Chrome made for
# the app, and the same registration names it for the "Open with" list
# (Application\ApplicationIcon). This copies that icon into DefaultIcon for
# every file type PDF Viewer registered, then has Explorer redraw its icons.
#
# Run it once after installing the app (double-click windows-file-icon.cmd),
# and again if the files go back to the blank page: Chrome writes the
# registration afresh when the app's file types change or it is reinstalled.
# Current user only (HKCU); no administrator rights needed.

$AppName = 'PDF Viewer'

$classes = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes')
$fixed = 0
$apps = 0

foreach ($name in $classes.GetSubKeyNames()) {
  try { $app = $classes.OpenSubKey($name) } catch { continue }
  if (-not $app) { continue }
  # Chrome lists the ProgIds of an app's file types on the app's own ProgId.
  $handlerList = $app.GetValue('FileHandlerProgIds')
  if (-not $handlerList) { continue }
  $info = $app.OpenSubKey('Application')
  if (-not $info) { continue }
  # "PDF Viewer", or "PDF Viewer (Profile 2)" when installed in two profiles.
  $title = [string]$info.GetValue('ApplicationName')
  if ($title -ne $AppName -and -not $title.StartsWith("$AppName (")) { continue }
  $apps++

  foreach ($progId in $handlerList.Split(';')) {
    $fileType = if ($progId) { $classes.OpenSubKey($progId) }
    if (-not $fileType) { continue }
    $handler = $fileType.OpenSubKey('Application')
    $icon = if ($handler) { [string]$handler.GetValue('ApplicationIcon') } else { '' }
    if (-not $icon) { $icon = [string]$info.GetValue('ApplicationIcon') }
    # "C:\...\PDF Viewer.ico,0": the file, then the icon's index in it.
    $iconFile = ($icon -replace ',-?\d+$', '').Trim('"')
    if (-not $iconFile -or -not (Test-Path -LiteralPath $iconFile)) {
      Write-Host "Skipped $progId - its icon file is missing: $iconFile"
      continue
    }
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\Classes\$progId\DefaultIcon")
    $key.SetValue('', $icon)
    $key.Close()
    $types = [string]$fileType.GetValue('FileExtensions')
    Write-Host "Set the $title icon on $types files"
    $fixed++
  }
}

if ($apps -eq 0) {
  Write-Host "$AppName is not installed for this Windows user, or Chrome has not registered its file types yet."
  Write-Host 'Install it from https://zrcoderre-ux.github.io/pdf-viewer/ and run this again.'
  exit 1
}

# Tell Explorer file associations changed (SHCNE_ASSOCCHANGED) so it redraws
# the icons now rather than at the next sign-in.
try {
  Add-Type -Namespace PdfViewer -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, uint flags, System.IntPtr item1, System.IntPtr item2);'
  [PdfViewer.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
} catch {
  $refresh = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
  if (Test-Path -LiteralPath $refresh) { & $refresh -show }
}

Write-Host "Done: $fixed file type(s). If a folder still shows the blank page, close and reopen it."
