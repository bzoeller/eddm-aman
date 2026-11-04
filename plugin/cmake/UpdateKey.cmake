# Oeffentlicher Schluessel fuer die Signatur der Updates lesen und pruefen.
# Eingaben: AMAN_UPDATE_PUBKEY (optional vorgegeben), KEY_FILE (tools/update-public-key.txt),
#           AMAN_REQUIRE_UPDATE_KEY (ON beim Release: ohne gueltigen Schluessel Abbruch statt Warnung)
# Ergebnis: AMAN_UPDATE_PUBKEY = 128 Hex-Zeichen oder leer (dann installiert das Plugin keine Updates)
if("${AMAN_UPDATE_PUBKEY}" STREQUAL "" AND EXISTS "${KEY_FILE}")
  file(READ "${KEY_FILE}" AMAN_UPDATE_PUBKEY)
endif()
string(STRIP "${AMAN_UPDATE_PUBKEY}" AMAN_UPDATE_PUBKEY)
string(TOLOWER "${AMAN_UPDATE_PUBKEY}" AMAN_UPDATE_PUBKEY)
string(LENGTH "${AMAN_UPDATE_PUBKEY}" _aman_key_len)   # CMake-Muster kennen kein {128}, deshalb die Laenge so
if(NOT _aman_key_len EQUAL 128 OR NOT AMAN_UPDATE_PUBKEY MATCHES "^[0-9a-f]+$")
  if(AMAN_REQUIRE_UPDATE_KEY)
    message(FATAL_ERROR "Kein gueltiger Update-Schluessel in ${KEY_FILE} (${_aman_key_len} Zeichen): Release abgebrochen.")
  endif()
  message(WARNING "Kein gueltiger Update-Schluessel: dieses Plugin installiert keine Updates.")
  set(AMAN_UPDATE_PUBKEY "")
else()
  message(STATUS "Update-Schluessel: ${AMAN_UPDATE_PUBKEY}")
endif()
