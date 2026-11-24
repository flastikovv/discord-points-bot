; Установщик VideoHub (ставится в профиль пользователя, права администратора не нужны)
Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"

!define APPNAME "VideoHub"
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

Name "${APPNAME}"
OutFile "..\dist\VideoHub-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel user
BrandingText "${APPNAME} ${VERSION}"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\VideoHub.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить VideoHub"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "FileDescription" "Установщик ${APPNAME}"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "LegalCopyright" ""

Section "Install"
  nsExec::Exec 'taskkill /F /IM VideoHub.exe'
  Sleep 800
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\resources"
  File /r "..\dist\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\VideoHub.exe"
  CreateShortCut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\VideoHub.exe"
  WriteRegStr HKCU "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\VideoHub.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM VideoHub.exe'
  Sleep 800
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APPNAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.videohub.app"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.VideoHub"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPNAME}"
  RMDir /r "$INSTDIR"
  ; данные (аккаунты, статистика) остаются в %APPDATA%\VideoHub
SectionEnd
