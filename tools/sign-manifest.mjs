// Signiert die Update-Liste beim Release: node tools/sign-manifest.mjs dist/manifest.txt [oeffentlicher-schluessel.txt]
// Der geheime Schluessel kommt aus der Umgebungsvariable UPDATE_SIGNING_KEY (PKCS#8, Base64 oder PEM),
// bei GitHub als Secret im Environment "release" (nur mit Freigabe durch den Betreuer erreichbar).
// Schreibt manifest.sig (ECDSA P-256 ueber SHA-256, r||s als Hex) neben die Liste.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [file, pubFile = new URL('./update-public-key.txt', import.meta.url).pathname] = process.argv.slice(2);
const fail = m => { console.error('FEHLER: ' + m); process.exit(1); };
if (!file) fail('Aufruf: node tools/sign-manifest.mjs <manifest.txt> [public-key.txt]');
const raw = (process.env.UPDATE_SIGNING_KEY || '').trim();
if (!raw) fail('UPDATE_SIGNING_KEY fehlt (Secret im GitHub-Environment "release", siehe docs/release.md)');

let key;
try {
  key = raw.includes('BEGIN') ? crypto.createPrivateKey(raw) : crypto.createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' });
} catch (e) { fail('geheimer Schluessel nicht lesbar: ' + e.message); }
if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1') fail('Schluessel ist kein ECDSA P-256');

// passt der geheime Schluessel zum oeffentlichen, der in die DLL eingebaut wird?
const jwk = crypto.createPublicKey(key).export({ format: 'jwk' });
const pubHex = Buffer.concat([Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('hex');
const want = fs.readFileSync(pubFile, 'utf8').trim().toLowerCase();
if (pubHex !== want) fail('geheimer Schluessel passt nicht zu ' + pubFile);

const text = fs.readFileSync(file);
const sig = crypto.sign('sha256', text, { key, dsaEncoding: 'ieee-p1363' });
const pub = crypto.createPublicKey(key);
if (!crypto.verify('sha256', text, { key: pub, dsaEncoding: 'ieee-p1363' }, sig)) fail('Selbstpruefung der Signatur fehlgeschlagen');
const out = path.join(path.dirname(file), 'manifest.sig');
fs.writeFileSync(out, sig.toString('hex'));
console.log('signiert: ' + out);
