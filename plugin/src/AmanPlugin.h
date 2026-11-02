// EuroScope-Plugin fuer den EDDM AMAN.
// Liest alle 5 s den Anflugverkehr nach EDDM aus EuroScope und stellt ihn unter
// http://127.0.0.1:8471/api/traffic bereit; unter http://127.0.0.1:8471/ laeuft die AMAN-Seite.
#pragma once
#include <memory>
#include <mutex>
#include <string>

#ifdef _WIN32
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>   // EuroScopePlugIn.h erwartet die Windows-Typen
#endif
#include "EuroScopePlugIn.h"
#include "HttpServer.h"
#include "Snapshot.h"

class CAmanPlugin : public EuroScopePlugIn::CPlugIn {
public:
    explicit CAmanPlugin(const std::string& webRoot);
    ~CAmanPlugin() override;

    void OnTimer(int counter) override;
    bool OnCompileCommand(const char* command) override;
    void OnNewMetarReceived(const char* station, const char* fullMetar) override;

    /** Verkehrsbild jetzt neu aufbauen (wird von OnTimer alle 5 s aufgerufen, im EuroScope-Thread). */
    void BuildSnapshot();
    std::string CurrentJson();

    static const unsigned short kPort = 8471;

private:
    void Message(const std::string& text);
    std::unique_ptr<aman::HttpServer> server_;
    std::mutex mtx_;
    std::string json_;
    std::string metar_;
};
