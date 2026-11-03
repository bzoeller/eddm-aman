// Pruefung der Update-Signatur: Die Liste der Update-Dateien (manifest.txt) ist beim Release mit einem
// geheimen Schluessel signiert (ECDSA P-256, SHA-256). Der passende oeffentliche Schluessel ist in die DLL
// eingebaut. So kann nur ein Update einspielen, wer den geheimen Schluessel hat, nicht wer nur ein Release anlegt.
#pragma once
#include <string>

namespace aman {

/**
 * text: Inhalt von manifest.txt, sigHex: Inhalt von manifest.sig (128 Hex-Zeichen, r||s),
 * pubHex: oeffentlicher Schluessel (128 Hex-Zeichen, x||y). true nur bei gueltiger Signatur.
 */
bool verifySignature(const std::string& text, const std::string& sigHex, const std::string& pubHex);

}  // namespace aman
