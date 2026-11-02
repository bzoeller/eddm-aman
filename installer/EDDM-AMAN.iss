; Installer fuer das EDDM-AMAN-Plugin (Inno Setup 6). Wird im Release-Ablauf gebaut:
;   iscc /DAppVersion=1.2.3 /DDist=..\dist installer\EDDM-AMAN.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Dist
  #define Dist "..\dist"
#endif

[Setup]
AppId={{6E7B2C1A-5D4F-4A63-9C21-EDD3A3A11A01}
AppName=EDDM AMAN
AppVersion={#AppVersion}
AppPublisher=EDDM AMAN contributors
AppPublisherURL=https://github.com/bzoeller/eddm-aman
DefaultDirName={userdocs}\EuroScope\Plugins\EDDM-AMAN
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#Dist}
OutputBaseFilename=EDDM-AMAN-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=EDDM AMAN (EuroScope plug-in)
CloseApplications=yes
LicenseFile=..\LICENSE

[Files]
Source: "{#Dist}\EDDM-AMAN.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Dist}\web\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs

[UninstallDelete]
Type: files; Name: "{app}\*.old"
Type: files; Name: "{app}\*.new"
Type: files; Name: "{app}\web\*.new"

[Run]
Filename: "{app}"; Description: "Open the plug-in folder"; Flags: postinstall shellexec skipifsilent unchecked

[Code]
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
    WizardForm.FinishedLabel.Caption :=
      'EDDM AMAN is installed.' + #13#10 + #13#10 +
      'First time only: in EuroScope open OTHER SET > Plug-ins..., click Load and select' + #13#10 +
      ExpandConstant('{app}') + '\EDDM-AMAN.dll' + #13#10 + #13#10 +
      'Then type .aman in the EuroScope command line to open the AMAN window.' + #13#10 +
      'Updates are installed automatically when EuroScope starts.';
end;
