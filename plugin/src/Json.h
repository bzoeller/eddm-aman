// Kleine JSON-Hilfen fuer das Plugin (ohne Fremdbibliothek).
#pragma once
#include <cmath>
#include <cstdio>
#include <string>

namespace aman {

/** Text als JSON-String mit Anfuehrungszeichen, alle Steuerzeichen escaped. */
inline std::string jsonStr(const std::string& s) {
    std::string o = "\"";
    for (unsigned char c : s) {
        switch (c) {
            case '"': o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n"; break;
            case '\r': o += "\\r"; break;
            case '\t': o += "\\t"; break;
            default:
                if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
                else o += static_cast<char>(c);
        }
    }
    return o + "\"";
}

/** Zahl als JSON; NaN oder unendlich wird null (der AMAN verwirft solche Datensaetze). */
inline std::string jsonNum(double v, int decimals = 5) {
    if (!std::isfinite(v)) return "null";
    char b[64];
    std::snprintf(b, sizeof b, "%.*f", decimals, v);
    return b;
}

}  // namespace aman
