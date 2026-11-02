#include "AmanPlugin.h"

#include <cctype>
#include <chrono>
#include <cmath>
#include <cstring>

#ifdef _WIN32
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#  include <shellapi.h>
#endif

using namespace EuroScopePlugIn;

namespace {

const char* kDest = "EDDM";
const double kLat = 48.3538, kLon = 11.7861;  // EDDM ARP
const char* kIafs[] = {"ROKIL", "LANDU", "BETOS", "NAPSA"};

double distNm(double lat1, double lon1, double lat2, double lon2) {
    const double r = 3.14159265358979323846 / 180.0;
    double dlat = (lat2 - lat1) * r, dlon = (lon2 - lon1) * r;
    double a = std::sin(dlat / 2) * std::sin(dlat / 2) + std::cos(lat1 * r) * std::cos(lat2 * r) * std::sin(dlon / 2) * std::sin(dlon / 2);
    return 3440.065 * 2 * std::atan2(std::sqrt(a), std::sqrt(1 - a));
}

std::string upper(const char* s) {
    std::string o = s ? s : "";
    for (char& c : o) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return o;
}

}  // namespace

CAmanPlugin::CAmanPlugin(const std::string& webRoot)
    : CPlugIn(COMPATIBILITY_CODE, "EDDM AMAN", "1.0.0", "EDDM AMAN", "for VATSIM and simulation only") {
    json_ = aman::Snapshot().toJson();
    server_.reset(new aman::HttpServer(webRoot, [this] { return CurrentJson(); }));
    std::string err;
    if (server_->start(kPort, &err))
        Message("AMAN running: http://127.0.0.1:8471/  (command .aman opens the browser)");
    else
        Message("AMAN could not start: " + err);
}

CAmanPlugin::~CAmanPlugin() {
    if (server_) server_->stop();
}

void CAmanPlugin::Message(const std::string& text) {
    DisplayUserMessage("EDDM AMAN", "AMAN", text.c_str(), true, true, false, false, false);
}

std::string CAmanPlugin::CurrentJson() {
    std::lock_guard<std::mutex> lock(mtx_);
    return json_;
}

void CAmanPlugin::OnTimer(int counter) {
    if (counter % 5 == 0) BuildSnapshot();
}

void CAmanPlugin::OnNewMetarReceived(const char* station, const char* fullMetar) {
    if (station && std::strcmp(station, kDest) == 0 && fullMetar) {
        std::lock_guard<std::mutex> lock(mtx_);
        metar_ = fullMetar;
    }
}

bool CAmanPlugin::OnCompileCommand(const char* command) {
    std::string c = upper(command);
    if (c.rfind(".AMAN", 0) != 0) return false;
#ifdef _WIN32
    ShellExecuteA(nullptr, "open", "http://127.0.0.1:8471/", nullptr, nullptr, SW_SHOWNORMAL);
#endif
    Message(server_ && server_->running() ? "AMAN: http://127.0.0.1:8471/" : "AMAN server not running (port 8471 in use?)");
    return true;
}

void CAmanPlugin::BuildSnapshot() {
    aman::Snapshot s;
    s.time = std::chrono::duration<double>(std::chrono::system_clock::now().time_since_epoch()).count();

    CController me = ControllerMyself();
    if (me.IsValid()) {
        s.myCallsign = me.GetCallsign() ? me.GetCallsign() : "";
        s.myFacility = std::to_string(me.GetFacility());
    }
    for (CController c = ControllerSelectFirst(); c.IsValid(); c = ControllerSelectNext(c))
        if (c.IsController() && c.GetCallsign()) s.controllers.push_back(c.GetCallsign());

    // aktive Landebahnen von EDDM (nur zum Vergleich mit dem AMAN, die Richtung bestimmt der AMAN)
    for (CSectorElement e = SectorFileElementSelectFirst(SECTOR_ELEMENT_RUNWAY); e.IsValid();
         e = SectorFileElementSelectNext(e, SECTOR_ELEMENT_RUNWAY)) {
        if (upper(e.GetAirportName()).find(kDest) == std::string::npos) continue;
        for (int i = 0; i < 2; i++)
            if (e.IsElementActive(false, i) && e.GetRunwayName(i)) s.arrRwys.push_back(upper(e.GetRunwayName(i)));
    }

    for (CRadarTarget rt = RadarTargetSelectFirst(); rt.IsValid(); rt = RadarTargetSelectNext(rt)) {
        CFlightPlan fp = rt.GetCorrelatedFlightPlan();
        if (!fp.IsValid()) continue;
        CFlightPlanData fd = fp.GetFlightPlanData();
        if (upper(fd.GetDestination()) != kDest) continue;
        CRadarTargetPositionData pos = rt.GetPosition();
        if (!pos.IsValid()) continue;
        aman::Aircraft a;
        a.cs = upper(rt.GetCallsign());
        a.lat = pos.GetPosition().m_Latitude;
        a.lon = pos.GetPosition().m_Longitude;
        a.alt = pos.GetPressureAltitude();
        a.gs = pos.GetReportedGS();
        a.hdg = pos.GetReportedHeading();
        a.trk = rt.GetTrackHeading();
        if (!std::isfinite(a.lat) || !std::isfinite(a.lon)) continue;
        if (distNm(kLat, kLon, a.lat, a.lon) > 250) continue;      // zu weit weg fuer den AMAN
        if (a.gs < 50 && a.alt < 2500) continue;                    // am Boden
        a.type = upper(fd.GetAircraftFPType());
        a.wtc = static_cast<char>(std::toupper(static_cast<unsigned char>(fd.GetAircraftWtc())));
        if (a.wtc != 'L' && a.wtc != 'M' && a.wtc != 'H' && a.wtc != 'J') a.wtc = 'M';
        a.route = fd.GetRoute() ? fd.GetRoute() : "";
        a.star = upper(fd.GetStarName());
        a.arrRwy = upper(fd.GetArrivalRwy());   // Landebahn im Flugplan bzw. Tag, aendert der Lotse sie, zieht der AMAN mit

        // IAF aus der berechneten Route; "passiert" nur melden, wenn EuroScope den Punkt als ueberflogen fuehrt
        CFlightPlanExtractedRoute er = fp.GetExtractedRoute();
        for (int i = 0; i < er.GetPointsNumber(); i++) {
            std::string n = upper(er.GetPointName(i));
            for (const char* iaf : kIafs) {
                if (n != iaf) continue;
                a.iaf = iaf;
                if (er.GetPointDistanceInMinutes(i) < 0) a.passedIaf = 1;  // laut SDK: -1 = bereits ueberflogen
            }
        }
        if (a.iaf.empty())
            for (const char* iaf : kIafs)
                if (a.star.rfind(iaf, 0) == 0) a.iaf = iaf;          // z. B. BETOS1A
        s.aircraft.push_back(a);
    }

    std::lock_guard<std::mutex> lock(mtx_);
    s.metar = metar_;
    json_ = s.toJson();
}
