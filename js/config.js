// config.js - Update default config untuk ESP32
/* ============================================================
   config.js — default settings & tunables
   Values here are the initial defaults; the user can override
   them at runtime via the "Pengaturan Broker" form (persisted
   to localStorage).
   ============================================================ */

window.APP_CONFIG = {
  // Public HiveMQ broker over secure WebSocket.
  url: "wss://broker.hivemq.com:8884/mqtt",

  // Topic untuk kompatibilitas (ESP32 menggunakan hydroponic/habib)
  dataTopic: "hydroponic/habib/sensor/all",
  commandTopic: "hydroponic/habib/control/relay",

  username: "",
  password: "",

  // Device is considered offline if no message arrives within this window (ms).
  deviceTimeout: 15000,

  // Hours of history retained for the trend chart.
  historyHours: 24,

  // Max entries kept in the activity log.
  logLimit: 60,
};

// localStorage key for persisted broker settings.
window.STORAGE_KEY = "monitoring-bawang:config";
