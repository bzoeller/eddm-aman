# EDDM AMAN, EuroScope-Plugin. Bauen unter Windows mit Visual Studio, 32 Bit (EuroScope ist ein 32-Bit-Programm):
#   cmake -S plugin -B build -A Win32 -DES_SDK_DIR=C:/pfad/zum/sdk
#   cmake --build build --config Release
cmake_minimum_required(VERSION 3.15)
project(EDDM-AMAN C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(ES_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/sdk" CACHE PATH "Ordner mit EuroScopePlugIn.h und EuroScopePlugInDll.lib aus dem EuroScope-SDK")

if(NOT EXISTS "${ES_SDK_DIR}/EuroScopePlugIn.h" OR NOT EXISTS "${ES_SDK_DIR}/EuroScopePlugInDll.lib")
  message(FATAL_ERROR "EuroScope-SDK nicht gefunden. EuroScopePlugIn.h und EuroScopePlugInDll.lib nach ${ES_SDK_DIR} kopieren oder -DES_SDK_DIR=... angeben.")
endif()
if(NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
  message(FATAL_ERROR "EuroScope-Plugins muessen 32 Bit sein: mit -A Win32 konfigurieren.")
endif()

# Version aus der Datei VERSION im Repo (oder -DAMAN_VERSION=... beim Release)
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../VERSION" AMAN_VERSION_FILE)
string(STRIP "${AMAN_VERSION_FILE}" AMAN_VERSION_FILE)
set(AMAN_VERSION "${AMAN_VERSION_FILE}" CACHE STRING "Versionsnummer des Plugins")
set(AMAN_UPDATE_BASE "https://github.com/bzoeller/eddm-aman/releases" CACHE STRING "Update-Quelle (GitHub-Releases)")
# Oeffentlicher Schluessel fuer die Signatur der Updates (tools/update-public-key.txt). Ohne ihn baut man ein Plugin ohne Auto-Update.
option(AMAN_REQUIRE_UPDATE_KEY "Ohne gueltigen Update-Schluessel abbrechen (Release)" OFF)
set(KEY_FILE "${CMAKE_CURRENT_SOURCE_DIR}/../tools/update-public-key.txt")
include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/UpdateKey.cmake")

add_library(EDDM-AMAN SHARED src/AmanPlugin.cpp src/HttpServer.cpp src/PluginMain.cpp src/Updater.cpp src/Signature.cpp src/uecc_build.c)
target_include_directories(EDDM-AMAN PRIVATE src "${ES_SDK_DIR}")
target_link_libraries(EDDM-AMAN PRIVATE "${ES_SDK_DIR}/EuroScopePlugInDll.lib" ws2_32 shell32 winhttp)
target_compile_definitions(EDDM-AMAN PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX AMAN_VERSION="${AMAN_VERSION}" AMAN_UPDATE_BASE="${AMAN_UPDATE_BASE}" AMAN_UPDATE_PUBKEY="${AMAN_UPDATE_PUBKEY}")
# Laufzeit statisch einbinden, damit kein zusaetzliches Visual-C++-Paket noetig ist
set_property(TARGET EDDM-AMAN PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# AMAN-Webseite in den Ordner "web" neben die DLL kopieren, bei jedem Build (auch wenn sich nur die Seite aendert)
add_custom_target(aman-web ALL
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/../web" "$<TARGET_FILE_DIR:EDDM-AMAN>/web"
  COMMENT "AMAN-Webseite nach web kopieren")
add_dependencies(aman-web EDDM-AMAN)
