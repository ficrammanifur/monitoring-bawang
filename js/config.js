/* ============================================================
   config.js — default settings & tunables
   ============================================================ */

window.APP_CONFIG = {
  // Public HiveMQ broker over secure WebSocket
  url: "wss://broker.hivemq.com:8884/mqtt",

  // Topic untuk ESP32
  dataTopic: "hydroponic/habib/sensor/all",
  commandTopic: "hydroponic/habib/control/relay",

  username: "",
  password: "",

  // Device timeout (ms)
  deviceTimeout: 15000,

  // Hours of history retained for the trend chart
  historyHours: 24,

  // Max entries kept in the activity log
  logLimit: 60,

  // Hysteresis thresholds (display only)
  thresholdOn: 45,
  thresholdOff: 65,
};

// localStorage key for persisted broker settings
window.STORAGE_KEY = "hydroponic-habib:config";
