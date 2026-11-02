// Verkehrsbild, wie es der AMAN unter /api/traffic erwartet. Unabhaengig von EuroScope, damit es testbar ist.
#pragma once
#include <string>
#include <vector>
#include "Json.h"

namespace aman {

struct Aircraft {
    std::string cs, type, route, star, arrRwy, iaf;
    char wtc = 'M';
    double lat = NAN, lon = NAN, trk = NAN, hdg = NAN;
    int alt = 0, gs = 0;
    int passedIaf = -1;   // -1 unbekannt, 0 nein, 1 ja
};

struct Snapshot {
    double time = 0;                       // UTC-Sekunden seit 1970, Zeitpunkt der Daten
    std::string myCallsign, myFacility;
    std::string metar;
    std::string pluginVersion;
    std::vector<std::string> arrRwys;      // aktive Landebahnen in EuroScope (nur zum Vergleich)
    std::vector<std::string> controllers;  // eingeloggte Lotsen
    std::vector<Aircraft> aircraft;

    std::string toJson() const {
        std::string o = "{\"version\":1,\"time\":" + jsonNum(time, 1);
        o += ",\"me\":{\"callsign\":" + jsonStr(myCallsign) + ",\"facility\":" + jsonStr(myFacility) + "}";
        o += ",\"metar\":" + jsonStr(metar) + ",\"pluginVersion\":" + jsonStr(pluginVersion);
        o += ",\"arrRwys\":[";
        for (size_t i = 0; i < arrRwys.size(); i++) o += (i ? "," : "") + jsonStr(arrRwys[i]);
        o += "],\"controllers\":[";
        for (size_t i = 0; i < controllers.size(); i++) o += (i ? "," : "") + jsonStr(controllers[i]);
        o += "],\"aircraft\":[";
        for (size_t i = 0; i < aircraft.size(); i++) {
            const Aircraft& a = aircraft[i];
            o += i ? "," : "";
            o += "{\"cs\":" + jsonStr(a.cs) + ",\"type\":" + jsonStr(a.type) + ",\"wtc\":" + jsonStr(std::string(1, a.wtc));
            o += ",\"lat\":" + jsonNum(a.lat) + ",\"lon\":" + jsonNum(a.lon);
            o += ",\"alt\":" + std::to_string(a.alt) + ",\"gs\":" + std::to_string(a.gs);
            o += ",\"trk\":" + jsonNum(a.trk, 0) + ",\"hdg\":" + jsonNum(a.hdg, 0);
            o += ",\"route\":" + jsonStr(a.route) + ",\"star\":" + jsonStr(a.star) + ",\"arrRwy\":" + jsonStr(a.arrRwy);
            if (!a.iaf.empty()) o += ",\"iaf\":" + jsonStr(a.iaf);
            if (a.passedIaf >= 0) o += std::string(",\"passedIaf\":") + (a.passedIaf ? "true" : "false");
            o += "}";
        }
        return o + "]}";
    }
};

}  // namespace aman
