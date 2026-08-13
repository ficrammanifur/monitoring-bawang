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
        this.client.subscribe(config.dataTopic, (err) => {
          if (err) this._log("Gagal subscribe: " + err.message);
          else this._log(`Subscribe ke ${config.dataTopic}`);
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
          const normalized = {
            soil: toNumber(data.soil ?? data.moisture ?? data.humidity),
            soilRaw: toNumber(data.soilRaw ?? data.raw ?? data.adc),
            temp: toNumber(data.temp ?? data.temperature),
            pump: toBool(data.pump ?? data.relay ?? data.pump_state),
            device: typeof data.device === "string" ? data.device : data.status,
            at: this.lastMessageAt,
          };
          this._emit("telemetry", normalized);
        } catch (e) {
          this._log("Payload bukan JSON valid: " + raw.slice(0, 40));
        }
      });
    }

    publishPump(on) {
      if (!this.client || !this.client.connected || !this.config) return false;
      const payload = JSON.stringify({ pump: on });
      this.client.publish(this.config.commandTopic, payload, { qos: 1 });
      this._log(`Kirim perintah pompa: ${on ? "ON" : "OFF"} \u2192 ${this.config.commandTopic}`);
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
