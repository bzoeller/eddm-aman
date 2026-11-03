#include "Signature.h"
#include "Sha256.h"

#include <cctype>
#include <cstdint>

extern "C" {
#include "../third_party/micro-ecc/uECC.h"
}

namespace aman {

namespace {
bool fromHex(std::string s, uint8_t* out, size_t n) {
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) s.erase(0, 1);
    if (s.size() != n * 2) return false;
    for (size_t i = 0; i < n; i++) {
        uint8_t v = 0;
        for (int k = 0; k < 2; k++) {
            char c = static_cast<char>(std::tolower(static_cast<unsigned char>(s[i * 2 + k])));
            v = static_cast<uint8_t>(v << 4);
            if (c >= '0' && c <= '9') v = static_cast<uint8_t>(v | (c - '0'));
            else if (c >= 'a' && c <= 'f') v = static_cast<uint8_t>(v | (c - 'a' + 10));
            else return false;
        }
        out[i] = v;
    }
    return true;
}
}  // namespace

bool verifySignature(const std::string& text, const std::string& sigHex, const std::string& pubHex) {
    uint8_t pub[64], sig[64], hash[32];
    if (!fromHex(pubHex, pub, 64) || !fromHex(sigHex, sig, 64)) return false;
    if (!fromHex(sha256Hex(text), hash, 32)) return false;
    const uECC_Curve curve = uECC_secp256r1();
    if (!uECC_valid_public_key(pub, curve)) return false;
    return uECC_verify(pub, hash, 32, sig, curve) == 1;
}

}  // namespace aman
