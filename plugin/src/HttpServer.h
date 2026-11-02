// Minimaler HTTP-Server fuer den AMAN: liefert die Webseite aus einem Ordner und /api/traffic.
// Hoert nur auf 127.0.0.1. Laeuft unter Windows (Winsock) und Linux (zum Testen).
#pragma once
#include <atomic>
#include <functional>
#include <mutex>
#include <string>
#include <thread>

namespace aman {

class HttpServer {
public:
    /** traffic liefert das aktuelle JSON (wird bei jeder Anfrage aufgerufen, muss threadsicher sein). */
    HttpServer(std::string webRoot, std::function<std::string()> traffic);
    ~HttpServer();
    bool start(unsigned short port, std::string* error = nullptr);
    void stop();
    bool running() const { return running_; }

private:
    void loop();
    void handle(long long client);
    std::string webRoot_;
    std::function<std::string()> traffic_;
    std::thread thread_;
    std::atomic<bool> running_{false};
    long long listenSock_ = -1;
};

}  // namespace aman
