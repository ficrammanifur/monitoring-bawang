/* ============================================================
   mqtt-client.js — thin wrapper around mqtt.js
   Exposes window.MqttService with event API
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
        clientId: "hydroponic-web-" + Math.random().toString(16).slice(2, 10),
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

        // Subscribe ke semua topik ESP32
        const topics = [
          config.dataTopic,
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
          const data = JSON.parse(raw);

          let normalized = {
            soil: null,
            soilRaw: null,
            filtered: null,
            temp: null,
            pump: null,
            device: null,
            at: this.lastMessageAt,
            mode: null,
            status: null,
            relay: null
          };

          if (topic === "hydroponic/habib/sensor/all") {
            // Format: {"adc":0,"moisture":62,"filtered":62.4,"status":"NORMAL","relay":"OFF","mode":"AUTO"}
            normalized.soil = toNumber(data.moisture);
            normalized.soilRaw = toNumber(data.adc);
            normalized.filtered = toNumber(data.filtered);
            normalized.pump = data.relay === "ON";
            normalized.mode = data.mode;
            normalized.status = data.status;
            normalized.device = "ESP32";
            this._log(`Data: ${data.status} (${data.filtered}%)`);
          } else if (topic === "hydroponic/habib/sensor/soil") {
            normalized.soilRaw = toNumber(raw);
          } else if (topic === "hydroponic/habib/sensor/moisture") {
            normalized.soil = toNumber(raw);
          } else if (topic === "hydroponic/habib/status/relay") {
            normalized.pump = raw.toUpperCase() === "ON";
          } else if (topic === "hydroponic/habib/status/device") {
            normalized.device = raw;
            this._emit("device", raw.toUpperCase() === "ONLINE");
          } else {
            normalized = {
              soil: toNumber(data.soil ?? data.moisture ?? data.humidity),
              soilRaw: toNumber(data.soilRaw ?? data.raw ?? data.adc),
              filtered: toNumber(data.filtered),
              temp: toNumber(data.temp ?? data.temperature),
              pump: toBool(data.pump ?? data.relay ?? data.pump_state),
              device: typeof data.device === "string" ? data.device : data.status,
              at: this.lastMessageAt,
              mode: data.mode,
              status: data.status
            };
          }

          this._emit("telemetry", normalized);
        } catch (e) {
          // Handle plain text messages
          if (topic === "hydroponic/habib/sensor/soil") {
            this._emit("telemetry", { soilRaw: toNumber(raw), at: this.lastMessageAt });
          } else if (topic === "hydroponic/habib/sensor/moisture") {
            this._emit("telemetry", { soil: toNumber(raw), at: this.lastMessageAt });
          } else if (topic === "hydroponic/habib/status/relay") {
            this._emit("telemetry", { pump: raw.toUpperCase() === "ON", at: this.lastMessageAt });
          } else {
            this._log(`Payload: ${raw.slice(0, 40)}`);
          }
        }
      });
    }

    publishPump(on) {
      if (!this.client || !this.client.connected || !this.config) return false;

      const command = on ? "ON" : "OFF";
      this.client.publish("hydroponic/habib/control/relay", command, { qos: 1 });
      this._log(`Kirim perintah: ${command} → hydroponic/habib/control/relay`);

      if (this.config.commandTopic) {
        this.client.publish(this.config.commandTopic, command, { qos: 1 });
      }

      return true;
    }

    publishMode(mode) {
      if (!this.client || !this.client.connected || !this.config) return false;

      const command = mode.toUpperCase();
      this.client.publish("hydroponic/habib/control/relay", command, { qos: 1 });
      this._log(`Kirim mode: ${command} → hydroponic/habib/control/relay`);

      if (this.config.commandTopic) {
        this.client.publish(this.config.commandTopic, command, { qos: 1 });
      }

      return true;
    }

    _armDeviceTimeout() {
      clearTimeout(this.deviceTimer);
      const ms = (this.config && this.config.deviceTimeout) || 15000;
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
        } catch (e) { /* noop */ }
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
