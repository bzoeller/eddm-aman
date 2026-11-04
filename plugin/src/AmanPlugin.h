// EuroScope-Plugin fuer den EDDM AMAN.
// Liest alle 5 s den Anflugverkehr nach EDDM aus EuroScope und stellt ihn unter
// http://127.0.0.1:8471/api/traffic bereit; unter http://127.0.0.1:8471/ laeuft die AMAN-Seite.
#pragma once
#include <atomic>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#ifdef _WIN32
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>   // EuroScopePlugIn.h erwartet die Windows-Typen
#endif
#include "EuroScopePlugIn.h"
#include "HttpServer.h"
#include "Snapshot.h"

class CAmanPlugin : public EuroScopePlugIn::CPlugIn {
public:
    /** pluginDir: Ordner der DLL (darin "web"), dllName: Dateiname der DLL (fuer das Update). */
    CAmanPlugin(const std::string& pluginDir, const std::string& dllName);
    ~CAmanPlugin() override;

    void OnTimer(int counter) override;
    bool OnCompileCommand(const char* command) override;
    void OnNewMetarReceived(const char* station, const char* fullMetar) override;

    /** Verkehrsbild jetzt neu aufbauen (wird von OnTimer alle 5 s aufgerufen, im EuroScope-Thread). */
    void BuildSnapshot();
    void DumpFlightPlan(std::string callsign);
    std::string CurrentJson();

    static const unsigned short kPort = 8471;

private:
    void Message(const std::string& text);
    void StartUpdateCheck(bool manual);
    void QueueMessage(const std::string& text);
    std::string pluginDir_, dllName_;
    std::thread updateThread_;
    std::atomic<bool> updating_{false};
    std::atomic<bool> stopping_{false};
    std::string applied_;              // eingespielte, noch nicht aktive Version (nur im Update-Thread geschrieben, danach gelesen)
    std::deque<std::string> pending_;   // Meldungen aus dem Update-Thread, angezeigt im EuroScope-Thread
    std::unique_ptr<aman::HttpServer> server_;
    std::mutex mtx_;
    std::string json_;
    std::string metar_;
};
