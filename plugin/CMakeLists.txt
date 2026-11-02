# EDDM AMAN, EuroScope-Plugin. Bauen unter Windows mit Visual Studio, 32 Bit (EuroScope ist ein 32-Bit-Programm):
#   cmake -S plugin -B build -A Win32 -DES_SDK_DIR=C:/pfad/zum/sdk
#   cmake --build build --config Release
cmake_minimum_required(VERSION 3.15)
project(EDDM-AMAN CXX)

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

add_library(EDDM-AMAN SHARED src/AmanPlugin.cpp src/HttpServer.cpp src/PluginMain.cpp src/Updater.cpp)
target_include_directories(EDDM-AMAN PRIVATE src "${ES_SDK_DIR}")
target_link_libraries(EDDM-AMAN PRIVATE "${ES_SDK_DIR}/EuroScopePlugInDll.lib" ws2_32 shell32 winhttp)
target_compile_definitions(EDDM-AMAN PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX AMAN_VERSION="${AMAN_VERSION}" AMAN_UPDATE_BASE="${AMAN_UPDATE_BASE}")
# Laufzeit statisch einbinden, damit kein zusaetzliches Visual-C++-Paket noetig ist
set_property(TARGET EDDM-AMAN PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# AMAN-Webseite in den Ordner "web" neben die DLL kopieren, bei jedem Build (auch wenn sich nur die Seite aendert)
set(WEB_FILES index.html app.js aman-core.js aman-sim.js eddm.json style.css)
set(WEB_CMDS COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:EDDM-AMAN>/web")
foreach(f ${WEB_FILES})
  list(APPEND WEB_CMDS COMMAND ${CMAKE_COMMAND} -E copy_if_different "${CMAKE_CURRENT_SOURCE_DIR}/../${f}" "$<TARGET_FILE_DIR:EDDM-AMAN>/web/${f}")
endforeach()
add_custom_target(aman-web ALL ${WEB_CMDS} COMMENT "AMAN-Webseite nach web kopieren")
add_dependencies(aman-web EDDM-AMAN)
