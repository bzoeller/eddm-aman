// TEST-ERSATZ fuer die EuroScope-Plugin-Schnittstelle, nur fuer Tests unter Linux.
// Bildet die vom AMAN-Plugin genutzten Teile nach; das echte EuroScopePlugIn.h kommt aus dem EuroScope-SDK.
#pragma once
#include <cstdio>
#include <string>
#include <vector>

#ifndef _WIN32
#  define __declspec(x)
#endif

namespace EuroScopePlugIn {

const int COMPATIBILITY_CODE = 16;
const int SECTOR_ELEMENT_RUNWAY = 4;

struct FakeTarget {
    std::string cs, type, dest = "EDDM", route, star, arrRwy, trackedBy, direct, scratch = "HOLD", annotation;
    char wtc = 'M';
    double lat = 0, lon = 0, trk = 0;
    int alt = 0, gs = 0, hdg = 0;
};
struct FakeWorld {
    std::vector<FakeTarget> targets;
    std::vector<std::string> arrRwys;          // aktive Landebahnen EDDM
    std::string me = "EDDM_N_APP";
    std::vector<std::string> controllers{"EDDM_N_APP", "EDMM_STA_CTR"};
};
inline FakeWorld& world() { static FakeWorld w; return w; }

class CPosition { public: double m_Latitude = 0, m_Longitude = 0; };

class CRadarTargetPositionData {
    const FakeTarget* t_;
public:
    explicit CRadarTargetPositionData(const FakeTarget* t = nullptr) : t_(t) {}
    bool IsValid() { return t_ != nullptr; }
    CPosition GetPosition() { CPosition p; p.m_Latitude = t_->lat; p.m_Longitude = t_->lon; return p; }
    int GetPressureAltitude() { return t_->alt; }
    int GetFlightLevel() { return t_->alt; }
    int GetReportedGS() { return t_->gs; }
    int GetReportedHeading() { return t_->hdg; }
};

class CFlightPlanData {
    const FakeTarget* t_;
public:
    explicit CFlightPlanData(const FakeTarget* t) : t_(t) {}
    const char* GetDestination() { return t_->dest.c_str(); }
    const char* GetOrigin() { return "ZZZZ"; }
    const char* GetRoute() { return t_->route.c_str(); }
    const char* GetStarName() { return t_->star.c_str(); }
    const char* GetArrivalRwy() { return t_->arrRwy.c_str(); }
    const char* GetAircraftFPType() { return t_->type.c_str(); }
    char GetAircraftWtc() { return t_->wtc; }
};

class CFlightPlanExtractedRoute {
public:
    int GetPointsNumber() { return 0; }
    const char* GetPointName(int) { return ""; }
    int GetPointDistanceInMinutes(int) { return 0; }
};

class CFlightPlanControllerAssignedData {
    const FakeTarget* t_;
public:
    explicit CFlightPlanControllerAssignedData(const FakeTarget* t) : t_(t) {}
    const char* GetDirectToPointName() { return t_->direct.c_str(); }
    const char* GetScratchPadString() { return t_->scratch.c_str(); }
    const char* GetFlightStripAnnotation(int i) { return i == 6 ? t_->annotation.c_str() : ""; }
    int GetAssignedHeading() { return 0; }
    int GetAssignedSpeed() { return 0; }
    int GetAssignedMach() { return 0; }
    int GetClearedAltitude() { return 0; }
};

class CFlightPlan {
    const FakeTarget* t_;
public:
    explicit CFlightPlan(const FakeTarget* t = nullptr) : t_(t) {}
    bool IsValid() { return t_ != nullptr; }
    CFlightPlanData GetFlightPlanData() { return CFlightPlanData(t_); }
    CFlightPlanExtractedRoute GetExtractedRoute() { return CFlightPlanExtractedRoute(); }
    const char* GetTrackingControllerCallsign() { return t_->trackedBy.c_str(); }
    CFlightPlanControllerAssignedData GetControllerAssignedData() { return CFlightPlanControllerAssignedData(t_); }
};

class CRadarTarget {
    int i_;
public:
    explicit CRadarTarget(int i = -1) : i_(i) {}
    bool IsValid() { return i_ >= 0 && i_ < static_cast<int>(world().targets.size()); }
    int Index() const { return i_; }
    const char* GetCallsign() { return world().targets[i_].cs.c_str(); }
    CRadarTargetPositionData GetPosition() { return CRadarTargetPositionData(&world().targets[i_]); }
    double GetTrackHeading() { return world().targets[i_].trk; }
    CFlightPlan GetCorrelatedFlightPlan() { return CFlightPlan(&world().targets[i_]); }
};

class CController {
    int i_;   // -2 = ich selbst, sonst Index in controllers
public:
    explicit CController(int i = -1) : i_(i) {}
    bool IsValid() { return i_ == -2 || (i_ >= 0 && i_ < static_cast<int>(world().controllers.size())); }
    int Index() const { return i_; }
    const char* GetCallsign() { return i_ == -2 ? world().me.c_str() : world().controllers[i_].c_str(); }
    bool IsController() { return true; }
    int GetFacility() { return 5; }
};

class CSectorElement {
    int i_;
public:
    explicit CSectorElement(int i = -1) : i_(i) {}
    bool IsValid() { return i_ == 0; }
    const char* GetAirportName() { return "EDDM Muenchen"; }
    const char* GetRunwayName(int idx) { return idx < static_cast<int>(world().arrRwys.size()) ? world().arrRwys[idx].c_str() : ""; }
    bool IsElementActive(bool isDeparture, int idx) { return !isDeparture && idx < static_cast<int>(world().arrRwys.size()); }
};

class CPlugIn {
public:
    CPlugIn(int, const char*, const char*, const char*, const char*) {}
    virtual ~CPlugIn() {}
    virtual void OnTimer(int) {}
    virtual bool OnCompileCommand(const char*) { return false; }
    virtual void OnNewMetarReceived(const char*, const char*) {}
    CRadarTarget RadarTargetSelectFirst() { return CRadarTarget(0); }
    CRadarTarget RadarTargetSelectNext(CRadarTarget c) { return CRadarTarget(c.Index() + 1); }
    CController ControllerMyself() { return CController(-2); }
    CController ControllerSelectFirst() { return CController(0); }
    CController ControllerSelectNext(CController c) { return CController(c.Index() + 1); }
    CSectorElement SectorFileElementSelectFirst(int) { return CSectorElement(0); }
    CSectorElement SectorFileElementSelectNext(CSectorElement, int) { return CSectorElement(-1); }
    void DisplayUserMessage(const char*, const char*, const char* msg, bool, bool, bool, bool, bool) { std::printf("[EuroScope-Meldung] %s\n", msg); std::fflush(stdout); }
};

}  // namespace EuroScopePlugIn
