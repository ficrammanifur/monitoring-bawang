// mqtt-client.js - Perbaikan untuk koneksi ke ESP32
/* ============================================================
   mqtt-client.js — thin wrapper around mqtt.js
   Exposes window.MqttClient with a small event API:
     onStatus(state)       "idle"|"connecting"|"connected"|"error"|"closed"
     onTelemetry(data)     parsed JSON payload (normalized)
     onDevice(online)      device online/offline
     onLog(text)           human-readable activity line
   ============================================================ */

(function () {
  function toNumber(v) {
    const n = typeof v === "string" ? parseFloat(v) : v;
    return typeof n === "number" && !Number.isNaN(n) ? n : null;
  }

  function toBool(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    if (typeof v === "string") return ["1", "true", "on", "yes"].includes(v.toLowerCase());
    return null;
  }

  class MqttService {
    constructor() {
      this.client = null;
      this.config = null;
      this.deviceTimer = null;
      this.handlers = { status: [], telemetry: [], device: [], log: [] };
      this.lastMessageAt = null;
    }

    on(event, cb) {
      if (this.handlers[event]) this.handlers[event].push(cb);
      return this;
    }

    _emit(event, payload) {
      (this.handlers[event] || []).forEach((cb) => cb(payload));
    }

    _log(text) {
      this._emit("log", text);
    }

    connect(config) {
      this.config = config;
      this.disconnect(true);
      this._emit("status", "connecting");
      this._log(`Menghubungkan ke ${config.url}`);

      const options = {
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 4000,
        clientId: "bawang-web-" + Math.random().toString(16).slice(2, 10),
      };
      if (config.username) options.username = config.username;
      if (config.password) options.password = config.password;

      try {
        this.client = mqtt.connect(config.url, options);
      } catch (err) {
        this._emit("status", "error");
        this._log("Gagal membuat koneksi: " + err.message);
        return;
      }

      this.client.on("connect", () => {
        this._emit("status", "connected");
        this._log("Broker terhubung");
        
        // Subscribe ke topik ESP32
        // ESP32 publish ke: hydroponic/habib/sensor/all
        // ESP32 publish ke: hydroponic/habib/sensor/soil
        // ESP32 publish ke: hydroponic/habib/sensor/moisture
        // ESP32 publish ke: hydroponic/habib/status/relay
        // ESP32 publish ke: hydroponic/habib/status/device
        
        const topics = [
          config.dataTopic,        // bawang/soil/data -> untuk kompatibilitas
          "hydroponic/habib/sensor/all",
          "hydroponic/habib/sensor/soil",
          "hydroponic/habib/sensor/moisture",
          "hydroponic/habib/status/relay",
          "hydroponic/habib/status/device"
        ];
        
        topics.forEach(topic => {
          this.client.subscribe(topic, (err) => {
            if (err) this._log(`Gagal subscribe ${topic}: ${err.message}`);
            else this._log(`Subscribe ke ${topic}`);
          });
        });
      });

      this.client.on("reconnect", () => this._emit("status", "connecting"));
      this.client.on("close", () => this._emit("status", "closed"));
      this.client.on("offline", () => {
        this._emit("status", "closed");
        this._setDeviceOffline();
      });
      this.client.on("error", (err) => {
        this._emit("status", "error");
        this._log("Error: " + err.message);
      });

      this.client.on("message", (topic, buf) => {
        const raw = buf.toString();
        this.lastMessageAt = Date.now();
        this._armDeviceTimeout();
        this._emit("device", true);

        try {
          // Coba parse JSON
          const data = JSON.parse(raw);
          
          // Normalisasi data dari ESP32
          let normalized = {
            soil: null,
            soilRaw: null,
            temp: null,
            pump: null,
            device: null,
            at: this.lastMessageAt,
            mode: null,
            status: null
          };

          // Handler untuk topik ESP32
          if (topic === "hydroponic/habib/sensor/all") {
            // Format: {"adc":0,"moisture":100,"status":"BASAH","relay":"OFF","mode":"AUTO"}
            normalized.soil = toNumber(data.moisture);
            normalized.soilRaw = toNumber(data.adc);
            normalized.pump = data.relay === "ON";
            normalized.mode = data.mode;
            normalized.status = data.status;
            normalized.device = "ESP32";
          } 
          else if (topic === "hydroponic/habib/sensor/soil") {
            // Format: angka ADC
            normalized.soilRaw = toNumber(raw);
          }
          else if (topic === "hydroponic/habib/sensor/moisture") {
            // Format: angka persen
            normalized.soil = toNumber(raw);
          }
          else if (topic === "hydroponic/habib/status/relay") {
            // Format: "ON" atau "OFF"
            normalized.pump = raw.toUpperCase() === "ON";
          }
          else if (topic === "hydroponic/habib/status/device") {
            // Format: "ONLINE" atau "OFFLINE"
            normalized.device = raw;
            this._emit("device", raw.toUpperCase() === "ONLINE");
          }
          else {
            // Fallback untuk topik default
            normalized = {
              soil: toNumber(data.soil ?? data.moisture ?? data.humidity),
              soilRaw: toNumber(data.soilRaw ?? data.raw ?? data.adc),
              temp: toNumber(data.temp ?? data.temperature),
              pump: toBool(data.pump ?? data.relay ?? data.pump_state),
              device: typeof data.device === "string" ? data.device : data.status,
              at: this.lastMessageAt,
            };
          }
          
          this._emit("telemetry", normalized);
          this._log(`Data dari ${topic}: ${raw.slice(0, 60)}`);
          
        } catch (e) {
          // Jika bukan JSON, coba handle sebagai plain text
          if (topic === "hydroponic/habib/sensor/soil") {
            this._emit("telemetry", {
              soilRaw: toNumber(raw),
              at: this.lastMessageAt
            });
          } 
          else if (topic === "hydroponic/habib/sensor/moisture") {
            this._emit("telemetry", {
              soil: toNumber(raw),
              at: this.lastMessageAt
            });
          }
          else if (topic === "hydroponic/habib/status/relay") {
            this._emit("telemetry", {
              pump: raw.toUpperCase() === "ON",
              at: this.lastMessageAt
            });
          }
          else {
            this._log(`Payload bukan JSON: ${raw.slice(0, 40)}`);
          }
        }
      });
    }

    publishPump(on) {
      if (!this.client || !this.client.connected || !this.config) return false;
      
      // Kirim perintah ke ESP32 dengan format yang dimengerti
      // ESP32 menerima: ON, OFF, AUTO
      const command = on ? "ON" : "OFF";
      const payload = command; // ESP32 expects plain text, not JSON
      
      this.client.publish("hydroponic/habib/control/relay", payload, { qos: 1 });
      this._log(`Kirim perintah pompa: ${command} → hydroponic/habib/control/relay`);
      
      // Kirim juga ke topic default untuk kompatibilitas
      if (this.config.commandTopic) {
        this.client.publish(this.config.commandTopic, JSON.stringify({ pump: on }), { qos: 1 });
      }
      
      return true;
    }

    _armDeviceTimeout() {
      clearTimeout(this.deviceTimer);
      const ms = (this.config && this.config.deviceTimeout) || 12000;
      this.deviceTimer = setTimeout(() => this._setDeviceOffline(), ms);
    }

    _setDeviceOffline() {
      this._emit("device", false);
    }

    disconnect(silent) {
      clearTimeout(this.deviceTimer);
      if (this.client) {
        try {
          this.client.end(true);
        } catch (e) {
          /* noop */
        }
        this.client = null;
      }
      if (!silent) {
        this._emit("status", "idle");
        this._emit("device", false);
        this._log("Koneksi diputus");
      }
    }
  }

  window.MqttService = MqttService;
})();
