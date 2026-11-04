// Testlauf des Plugins unter Linux: liest Verkehr aus einer Datei (geschrieben von feed.js aus der
// AMAN-Simulation) und ruft wie EuroScope jede Sekunde OnTimer auf. Server auf 127.0.0.1:8471.
#include <chrono>
#include <csignal>
#include <fstream>
#include <sstream>
#include <thread>

#include "AmanPlugin.h"

using EuroScopePlugIn::world;
static volatile bool g_run = true;

// Zeilenformat (Tab-getrennt): cs type wtc lat lon alt gs trk route star arrRwy dest [trackedBy] [direct]
static void load(const std::string& file) {
    std::ifstream f(file);
    if (!f) return;
    std::vector<EuroScopePlugIn::FakeTarget> v;
    std::string line;
    while (std::getline(f, line)) {
        if (line.rfind("#ME ", 0) == 0) { world().me = line.substr(4); continue; }
        if (line.rfind("#CTRL ", 0) == 0) { std::istringstream r(line.substr(6)); std::string x; world().controllers.clear(); while (r >> x) world().controllers.push_back(x); continue; }
        if (line.rfind("#RWY", 0) == 0) { std::istringstream r(line.substr(4)); std::string x; world().arrRwys.clear(); while (r >> x) world().arrRwys.push_back(x); continue; }
        std::vector<std::string> c;
        std::istringstream ss(line);
        std::string x;
        while (std::getline(ss, x, '\t')) c.push_back(x);
        if (c.size() < 12) continue;
        EuroScopePlugIn::FakeTarget t;
        t.cs = c[0]; t.type = c[1]; t.wtc = c[2].empty() ? 'M' : c[2][0];
        t.lat = std::stod(c[3]); t.lon = std::stod(c[4]); t.alt = std::stoi(c[5]); t.gs = std::stoi(c[6]);
        t.trk = std::stod(c[7]); t.hdg = static_cast<int>(t.trk); t.route = c[8]; t.star = c[9]; t.arrRwy = c[10]; t.dest = c[11];
        if (c.size() > 12) t.trackedBy = c[12];
        if (c.size() > 13) t.direct = c[13];
        v.push_back(t);
    }
    world().targets = v;
}

int main(int argc, char** argv) {
    if (argc < 3) { std::fprintf(stderr, "Aufruf: harness <plugin-ordner mit web/> <verkehrsdatei>\n"); return 2; }
    std::signal(SIGTERM, [](int) { g_run = false; });
    std::signal(SIGINT, [](int) { g_run = false; });
    CAmanPlugin* p = new CAmanPlugin(argv[1], "EDDM-AMAN.dll");
    p->OnNewMetarReceived("EDDM", "EDDM 021050Z 25012KT 9999 FEW030 08/02 Q1018 NOSIG");
    p->OnCompileCommand(".aman");
    for (int counter = 0; g_run; counter++) {
        load(argv[2]);
        // einmal den Diagnose-Befehl fuer den ersten Flieger (Test von .aman dump)
        if (counter == 2 && !world().targets.empty()) p->OnCompileCommand((".aman dump " + world().targets[0].cs).c_str());
        p->OnTimer(counter);
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }
    delete p;
    return 0;
}
