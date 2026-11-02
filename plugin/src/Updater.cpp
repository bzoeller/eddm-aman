#include "Updater.h"

#include <chrono>
#include <cstdio>
#include <filesystem>
#include <thread>
#include <fstream>
#include <sstream>

#include "Sha256.h"

#ifdef _WIN32
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#  include <winhttp.h>
#endif

namespace fs = std::filesystem;

namespace aman {

int compareVersions(const std::string& a, const std::string& b) {
    std::istringstream sa(a), sb(b);
    for (int i = 0; i < 4; i++) {
        long x = 0, y = 0;
        std::string pa, pb;
        if (std::getline(sa, pa, '.')) x = std::strtol(pa.c_str(), nullptr, 10);
        if (std::getline(sb, pb, '.')) y = std::strtol(pb.c_str(), nullptr, 10);
        if (x != y) return x < y ? -1 : 1;
    }
    return 0;
}

bool parseManifest(const std::string& text, Manifest& out) {
    std::istringstream in(text);
    std::string line;
    out = Manifest();
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        std::istringstream ls(line);
        std::string a, b, c;
        ls >> a;
        if (a.empty() || a[0] == '#') continue;
        if (a == "version") { ls >> out.version; continue; }
        if (a != "dll" && a != "web") return false;
        ls >> b >> c;
        // nur einfache Dateinamen, keine Pfade
        if (b.empty() || c.size() != 64 || b.find_first_of("/\\:") != std::string::npos || b.find("..") != std::string::npos) return false;
        out.files.push_back({a, b, c});
    }
    return !out.version.empty() && !out.files.empty();
}

Updater::Updater(std::string pluginDir, std::string dllName, std::string currentVersion, std::string baseUrl, Fetch fetch, Log log)
    : dir_(std::move(pluginDir)), dll_(std::move(dllName)), current_(std::move(currentVersion)), base_(std::move(baseUrl)),
      fetch_(std::move(fetch)), log_(std::move(log)) {}

void Updater::cleanup() {
    std::error_code ec;
    fs::remove(fs::path(dir_) / (dll_ + ".old"), ec);
}

bool Updater::writeFile(const std::string& path, const std::string& data) {
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    if (!f) return false;
    f.write(data.data(), static_cast<std::streamsize>(data.size()));
    return static_cast<bool>(f);
}

std::string Updater::checkAndApply() {
    std::string text;
    if (!fetch_(base_ + "/latest/download/manifest.txt", text)) { log_("update check failed (no connection to GitHub)"); return ""; }
    Manifest m;
    if (!parseManifest(text, m)) { log_("update check failed (invalid manifest)"); return ""; }
    if (compareVersions(m.version, current_) <= 0) return "";

    // 1) alles laden und pruefen, erst dann irgendetwas ersetzen
    const fs::path dir(dir_), web = dir / "web";
    std::vector<std::pair<fs::path, fs::path>> moves;  // .new -> Ziel
    auto discard = [&moves] { std::error_code e2; for (auto& mv : moves) fs::remove(mv.first, e2); };  // nichts Halbes liegen lassen
    for (const UpdateFile& f : m.files) {
        std::string body;
        if (!fetch_(base_ + "/download/v" + m.version + "/" + f.name, body)) { log_("update " + m.version + ": download of " + f.name + " failed"); discard(); return ""; }
        if (sha256Hex(body) != f.sha) { log_("update " + m.version + ": checksum of " + f.name + " wrong, update discarded"); discard(); return ""; }
        fs::path target = f.target == "dll" ? dir / dll_ : web / f.name;
        fs::path tmp = target; tmp += ".new";
        std::error_code ec;
        fs::create_directories(target.parent_path(), ec);
        if (!writeFile(tmp.string(), body)) { log_("update " + m.version + ": cannot write " + tmp.string()); discard(); return ""; }
        moves.push_back({tmp, target});
    }
    // 2) einspielen; die laufende DLL wird umbenannt (unter Windows erlaubt) und beim naechsten Start geloescht
    for (auto& mv : moves) {
        std::error_code ec;
        if (mv.second.filename() == dll_) {
            fs::path old = mv.second; old += ".old";
            fs::remove(old, ec);
            fs::rename(mv.second, old, ec);
        }
        // haelt der Webserver eine Datei gerade offen, kurz warten und nochmal versuchen
        for (int tries = 0; tries < 5; tries++) {
            ec.clear();
            fs::rename(mv.first, mv.second, ec);
            if (!ec) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
        }
        if (ec) { log_("update " + m.version + ": cannot replace " + mv.second.string() + " (" + ec.message() + ")"); return ""; }
    }
    return m.version;
}

#ifdef _WIN32
bool httpGet(const std::string& url, std::string& body) {
    std::wstring wurl(url.begin(), url.end());
    URL_COMPONENTS uc{};
    uc.dwStructSize = sizeof uc;
    wchar_t host[256], path[2048];
    uc.lpszHostName = host; uc.dwHostNameLength = 256;
    uc.lpszUrlPath = path; uc.dwUrlPathLength = 2048;
    if (!WinHttpCrackUrl(wurl.c_str(), 0, 0, &uc)) return false;
    HINTERNET s = WinHttpOpen(L"EDDM-AMAN-Updater", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!s) return false;
    WinHttpSetTimeouts(s, 5000, 5000, 5000, 10000);   // kurz, damit das Entladen des Plugins nicht lange wartet
    bool ok = false;
    HINTERNET c = WinHttpConnect(s, host, uc.nPort, 0);
    if (c) {
        HINTERNET r = WinHttpOpenRequest(c, L"GET", path, nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                         uc.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0);
        if (r && WinHttpSendRequest(r, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) && WinHttpReceiveResponse(r, nullptr)) {
            DWORD code = 0, len = sizeof code;
            WinHttpQueryHeaders(r, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &code, &len, WINHTTP_NO_HEADER_INDEX);
            if (code == 200) {
                body.clear();
                ok = true;
                for (;;) {
                    DWORD avail = 0;
                    if (!WinHttpQueryDataAvailable(r, &avail)) { ok = false; break; }   // abgebrochen: kein gueltiger Download
                    if (avail == 0) break;                                               // fertig
                    std::string chunk(avail, '\0');
                    DWORD got = 0;
                    if (!WinHttpReadData(r, &chunk[0], avail, &got)) { ok = false; break; }
                    body.append(chunk.data(), got);
                }
            }
        }
        if (r) WinHttpCloseHandle(r);
        WinHttpCloseHandle(c);
    }
    WinHttpCloseHandle(s);
    return ok;
}
#else
bool httpGet(const std::string& url, std::string& body) {
    // nur fuer Tests unter Linux
    if (url.find_first_of("'\"`$\\ ") != std::string::npos) return false;
    std::string cmd = "curl -fsSL --max-time 20 '" + url + "'";
    FILE* p = popen(cmd.c_str(), "r");
    if (!p) return false;
    body.clear();
    char buf[8192];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, p)) > 0) body.append(buf, n);
    return pclose(p) == 0;
}
#endif

}  // namespace aman
