// Update-Pruefung fuer das AMAN-Plugin.
// Holt von GitHub die Liste der neuesten Version (manifest.txt), vergleicht die Version, laedt neuere
// Dateien, prueft jede per SHA-256 und spielt sie ein: Webseite sofort, DLL beim naechsten EuroScope-Start.
//
// manifest.txt (wird beim Release erzeugt), je Zeile:
//   version 1.2.0
//   dll EDDM-AMAN.dll <sha256>
//   web index.html <sha256>
// manifest.sig: Signatur von manifest.txt (ECDSA P-256, siehe Signature.h). Ohne gueltige Signatur kein Update.
#pragma once
#include <functional>
#include <string>
#include <vector>

namespace aman {

struct UpdateFile { std::string target, name, sha; };
struct Manifest { std::string version; std::vector<UpdateFile> files; };

/** Versionsvergleich "1.10.0" > "1.9.3"; liefert -1, 0, 1. */
int compareVersions(const std::string& a, const std::string& b);
/** manifest.txt lesen; false bei Formatfehlern. */
bool parseManifest(const std::string& text, Manifest& out);

class Updater {
public:
    using Fetch = std::function<bool(const std::string& url, std::string& body)>;
    using Log = std::function<void(const std::string& msg)>;
    /**
     * pluginDir: Ordner der DLL (darin "web"), dllName: Dateiname der laufenden DLL,
     * baseUrl: z. B. https://github.com/<owner>/<repo>/releases,
     * publicKey: oeffentlicher Update-Schluessel (128 Hex-Zeichen); leer = Updates aus (z. B. eigener Build)
     */
    Updater(std::string pluginDir, std::string dllName, std::string currentVersion, std::string baseUrl, std::string publicKey, Fetch fetch, Log log);
    /** Einmal pruefen und ggf. einspielen. Liefert die neue Version oder "". Blockiert (eigener Thread!). */
    std::string checkAndApply();
    /** Reste eines frueheren Updates (*.old) entfernen. */
    void cleanup();

private:
    bool writeFile(const std::string& path, const std::string& data);
    std::string dir_, dll_, current_, base_, pub_;
    Fetch fetch_;
    Log log_;
};

/** HTTPS-Abruf: unter Windows WinHTTP (folgt Weiterleitungen), sonst curl (nur fuer Tests). */
bool httpGet(const std::string& url, std::string& body);

}  // namespace aman
