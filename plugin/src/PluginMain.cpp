// Einstieg fuer EuroScope: wird beim Laden bzw. Entladen der DLL aufgerufen.
#include "AmanPlugin.h"

#ifdef _WIN32
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
extern "C" IMAGE_DOS_HEADER __ImageBase;
#endif

static CAmanPlugin* g_plugin = nullptr;

/** Ordner und Dateiname dieser DLL (darin der Ordner "web" mit der AMAN-Seite). */
static void ModulePath(std::string& dir, std::string& name) {
#ifdef _WIN32
    char path[MAX_PATH] = {0};
    GetModuleFileNameA(reinterpret_cast<HINSTANCE>(&__ImageBase), path, MAX_PATH);
    std::string p(path);
    size_t k = p.find_last_of("\\/");
    dir = p.substr(0, k);
    name = p.substr(k + 1);
#else
    dir = ".";
    name = "EDDM-AMAN.dll";
#endif
}

void __declspec(dllexport) EuroScopePlugInInit(EuroScopePlugIn::CPlugIn** ppPlugInInstance) {
    std::string dir, name;
    ModulePath(dir, name);
    *ppPlugInInstance = g_plugin = new CAmanPlugin(dir, name);
}

void __declspec(dllexport) EuroScopePlugInExit(void) {
    delete g_plugin;
    g_plugin = nullptr;
}
