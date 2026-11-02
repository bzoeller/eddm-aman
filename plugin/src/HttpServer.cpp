#include "HttpServer.h"

#include <cstring>
#include <fstream>
#include <sstream>
#include <vector>

#ifdef _WIN32
#  define WIN32_LEAN_AND_MEAN
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  pragma comment(lib, "Ws2_32.lib")
   typedef SOCKET sock_t;
#  define CLOSESOCK closesocket
#else
#  include <arpa/inet.h>
#  include <netinet/in.h>
#  include <sys/socket.h>
#  include <unistd.h>
   typedef int sock_t;
#  define INVALID_SOCKET (-1)
#  define CLOSESOCK ::close
#endif

namespace aman {

namespace {

const char* mimeFor(const std::string& p) {
    auto ends = [&](const char* e) { size_t n = std::strlen(e); return p.size() >= n && p.compare(p.size() - n, n, e) == 0; };
    if (ends(".html")) return "text/html; charset=utf-8";
    if (ends(".js")) return "text/javascript; charset=utf-8";
    if (ends(".css")) return "text/css; charset=utf-8";
    if (ends(".json")) return "application/json; charset=utf-8";
    if (ends(".png")) return "image/png";
    if (ends(".svg")) return "image/svg+xml";
    return "application/octet-stream";
}

void sendAll(sock_t s, const std::string& data) {
    size_t off = 0;
    while (off < data.size()) {
        int n = ::send(s, data.data() + off, static_cast<int>(data.size() - off), 0);
        if (n <= 0) return;
        off += static_cast<size_t>(n);
    }
}

void respond(sock_t s, int code, const char* status, const char* type, const std::string& body) {
    std::ostringstream h;
    h << "HTTP/1.1 " << code << " " << status << "\r\n"
      << "Content-Type: " << type << "\r\n"
      << "Content-Length: " << body.size() << "\r\n"
      << "Cache-Control: no-store\r\n"
      << "X-Content-Type-Options: nosniff\r\n"
      << "Connection: close\r\n\r\n";
    sendAll(s, h.str() + body);
}

}  // namespace

HttpServer::HttpServer(std::string webRoot, std::function<std::string()> traffic)
    : webRoot_(std::move(webRoot)), traffic_(std::move(traffic)) {}

HttpServer::~HttpServer() { stop(); }

bool HttpServer::start(unsigned short port, std::string* error) {
#ifdef _WIN32
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) { if (error) *error = "WSAStartup failed"; return false; }
#endif
    sock_t s = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) { if (error) *error = "socket failed"; return false; }
    int yes = 1;
    ::setsockopt(s, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&yes), sizeof yes);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);  // nur dieser Rechner
    if (::bind(s, reinterpret_cast<sockaddr*>(&addr), sizeof addr) != 0 || ::listen(s, 16) != 0) {
        CLOSESOCK(s);
        if (error) *error = "port " + std::to_string(port) + " is in use";
        return false;
    }
    listenSock_ = static_cast<long long>(s);
    running_ = true;
    thread_ = std::thread([this] { loop(); });
    return true;
}

void HttpServer::stop() {
    if (!running_) return;
    running_ = false;
    sock_t s = static_cast<sock_t>(listenSock_);
#ifdef _WIN32
    ::shutdown(s, SD_BOTH);
#else
    ::shutdown(s, SHUT_RDWR);
#endif
    CLOSESOCK(s);
    if (thread_.joinable()) thread_.join();
#ifdef _WIN32
    WSACleanup();
#endif
}

void HttpServer::loop() {
    while (running_) {
        sock_t c = ::accept(static_cast<sock_t>(listenSock_), nullptr, nullptr);
        if (c == INVALID_SOCKET) { if (!running_) break; continue; }
        handle(static_cast<long long>(c));
        CLOSESOCK(c);
    }
}

void HttpServer::handle(long long client) {
    sock_t c = static_cast<sock_t>(client);
    // Zeitlimit beim Lesen, damit ein haengender Client den Server nicht blockiert
#ifdef _WIN32
    DWORD tv = 2000;
    ::setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&tv), sizeof tv);
#else
    timeval tv{2, 0};
    ::setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
#endif
    std::string req;
    char buf[2048];
    while (req.find("\r\n\r\n") == std::string::npos && req.size() < 16384) {
        int n = ::recv(c, buf, sizeof buf, 0);
        if (n <= 0) break;
        req.append(buf, static_cast<size_t>(n));
    }
    std::istringstream line(req.substr(0, req.find("\r\n")));
    std::string method, target;
    line >> method >> target;
    if (method != "GET" && method != "HEAD") { respond(c, 405, "Method Not Allowed", "text/plain", "GET only"); return; }
    std::string path = target.substr(0, target.find('?'));

    if (path == "/api/traffic") { respond(c, 200, "OK", "application/json; charset=utf-8", traffic_()); return; }
    if (path == "/") path = "/index.html";
    // nur einfache Dateinamen im Web-Ordner, kein Zugriff ausserhalb
    if (path.find("..") != std::string::npos || path.find('\\') != std::string::npos || path.find(':') != std::string::npos) {
        respond(c, 403, "Forbidden", "text/plain", "forbidden");
        return;
    }
    std::ifstream f(webRoot_ + path, std::ios::binary);
    if (!f) { respond(c, 404, "Not Found", "text/plain", "not found: " + path); return; }
    std::ostringstream body;
    body << f.rdbuf();
    respond(c, 200, "OK", mimeFor(path), body.str());
}

}  // namespace aman
