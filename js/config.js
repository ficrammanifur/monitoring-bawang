/* ============================================================
   config.js — default settings & tunables
   Values here are the initial defaults; the user can override
   them at runtime via the "Pengaturan Broker" form (persisted
   to localStorage).
   ============================================================ */

window.APP_CONFIG = {
  // Public HiveMQ broker over secure WebSocket.
  url: "wss://broker.hivemq.com:8884/mqtt",

  // Single JSON payload topics.
  dataTopic: "bawang/soil/data",
  commandTopic: "bawang/soil/cmd",

  username: "",
  password: "",

  // Device is considered offline if no message arrives within this window (ms).
  deviceTimeout: 12000,

  // Hours of history retained for the trend chart.
  historyHours: 24,

  // Max entries kept in the activity log.
  logLimit: 60,
};

// localStorage key for persisted broker settings.
window.STORAGE_KEY = "monitoring-bawang:config";
