// Einstieg fuer EuroScope: wird beim Laden bzw. Entladen der DLL aufgerufen.
#include "AmanPlugin.h"

#ifdef _WIN32
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
extern "C" IMAGE_DOS_HEADER __ImageBase;
#endif

static CAmanPlugin* g_plugin = nullptr;

/** Ordner "web" neben der DLL: dort liegen index.html, app.js usw. */
static std::string WebRoot() {
#ifdef _WIN32
    char path[MAX_PATH] = {0};
    GetModuleFileNameA(reinterpret_cast<HINSTANCE>(&__ImageBase), path, MAX_PATH);
    std::string p(path);
    return p.substr(0, p.find_last_of("\\/")) + "\\web";
#else
    return "web";
#endif
}

void __declspec(dllexport) EuroScopePlugInInit(EuroScopePlugIn::CPlugIn** ppPlugInInstance) {
    *ppPlugInInstance = g_plugin = new CAmanPlugin(WebRoot());
}

void __declspec(dllexport) EuroScopePlugInExit(void) {
    delete g_plugin;
    g_plugin = nullptr;
}
