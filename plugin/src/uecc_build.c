/* micro-ecc nur mit der Kurve P-256 (secp256r1) bauen: mehr braucht die Pruefung der Update-Signatur nicht. */
#define uECC_SUPPORTS_secp160r1 0
#define uECC_SUPPORTS_secp192r1 0
#define uECC_SUPPORTS_secp224r1 0
#define uECC_SUPPORTS_secp256r1 1
#define uECC_SUPPORTS_secp256k1 0
#define uECC_SUPPORT_COMPRESSED_POINT 0
#include "../third_party/micro-ecc/uECC.c"
