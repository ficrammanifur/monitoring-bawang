/* ============================================================
   app.js — glue: DOM <-> MqttService <-> TrendChart
   ============================================================ */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---- Config (defaults merged with persisted overrides) ----
  function loadConfig() {
    const base = { ...window.APP_CONFIG };
    try {
      const saved = JSON.parse(localStorage.getItem(window.STORAGE_KEY) || "{}");
      return { ...base, ...saved };
    } catch (e) {
      return base;
    }
  }

  function saveConfig(cfg) {
    const { url, dataTopic, commandTopic, username, password } = cfg;
    localStorage.setItem(window.STORAGE_KEY, JSON.stringify({ url, dataTopic, commandTopic, username, password }));
  }

  let config = loadConfig();
  const mqtt = new window.MqttService();
  const trend = new window.TrendChart("trend-chart", config.historyHours);

  // ---- Telemetry state ----
  let pumpOn = false;

  // ---- DOM refs ----
  const el = {
    dotBroker: $("dot-broker"),
    dotBroker2: $("dot-broker-2"),
    textBroker: $("text-broker"),
    connBroker: $("conn-broker"),
    dotDevice: $("dot-device"),
    dotDevice2: $("dot-device-2"),
    textDevice: $("text-device"),
    connDevice: $("conn-device"),
    connLast: $("conn-last"),
    connUrl: $("conn-url"),
    soilPercent: $("soil-percent"),
    soilRaw: $("soil-raw"),
    soilState: $("soil-state"),
    tempVal: $("temp-val"),
    gaugeArc: $("gauge-arc"),
    pumpState: $("pump-state"),
    pumpToggle: $("pump-toggle"),
    pumpToggleLabel: $("pump-toggle-label"),
    btnOn: $("btn-on"),
    btnOff: $("btn-off"),
    pumpHint: $("pump-hint"),
    chartEmpty: $("chart-empty"),
    logList: $("log-list"),
    footClock: $("foot-clock"),
  };

  const GAUGE_CIRC = 2 * Math.PI * 52; // r=52

  // ---- Rendering helpers ----
  function setDot(node, cls) {
    node.className = "dot" + (cls ? " " + cls : "");
  }

  function renderStatus(state) {
    const map = {
      idle: ["", "Idle", "Idle"],
      connecting: ["warn", "Menghubungkan\u2026", "Menghubungkan"],
      connected: ["on", "Broker OK", "Connected"],
      error: ["off", "Broker Error", "Error"],
      closed: ["off", "Terputus", "Disconnected"],
    };
    const [cls, badge, conn] = map[state] || map.idle;
    setDot(el.dotBroker, cls);
    setDot(el.dotBroker2, cls);
    el.textBroker.textContent = badge;
    el.connBroker.textContent = conn;

    const connected = state === "connected";
    el.btnOn.disabled = !connected;
    el.btnOff.disabled = !connected;
    el.pumpToggle.disabled = !connected;
    if (!connected) {
      el.pumpHint.textContent = "Menunggu koneksi broker\u2026";
    } else {
      el.pumpHint.textContent = "Perintah dikirim sebagai {\"pump\": true|false}";
    }
  }

  function renderDevice(online) {
    setDot(el.dotDevice, online ? "on" : "off");
    setDot(el.dotDevice2, online ? "on" : "off");
    el.textDevice.textContent = online ? "ESP32 Online" : "ESP32 Offline";
    el.connDevice.textContent = online ? "Online" : "Offline";
  }

  function soilStateLabel(pct) {
    if (pct == null) return ["\u2014", ""];
    if (pct < 30) return ["Kering", "bad"];
    if (pct < 60) return ["Ideal", "good"];
    return ["Basah", "warn"];
  }

  function renderTelemetry(d) {
    if (d.soil != null) {
      const pct = Math.max(0, Math.min(100, d.soil));
      el.soilPercent.textContent = Math.round(pct);
      el.gaugeArc.style.strokeDashoffset = GAUGE_CIRC * (1 - pct / 100);
      const [label, cls] = soilStateLabel(pct);
      el.soilState.textContent = label;
      el.soilState.className = "pill " + cls;
      // Color the arc by state.
      el.gaugeArc.style.stroke = cls === "bad" ? "#f87171" : cls === "warn" ? "#fbbf24" : "#4ade80";
    }
    if (d.soilRaw != null) el.soilRaw.textContent = Math.round(d.soilRaw);
    if (d.temp != null) el.tempVal.textContent = d.temp.toFixed(1);

    if (d.pump != null) setPumpUI(d.pump);

    el.connLast.textContent = new Date(d.at).toLocaleTimeString("id-ID");

    // Feed the hourly chart.
    if (d.soil != null || d.temp != null) {
      trend.record(d.soil, d.temp);
      el.chartEmpty.classList.add("hidden");
    }
  }

  function setPumpUI(on) {
    pumpOn = on;
    el.pumpState.textContent = on ? "ON" : "OFF";
    el.pumpState.className = "pill " + (on ? "good" : "");
    el.pumpToggle.classList.toggle("active", on);
    el.pumpToggle.setAttribute("aria-pressed", String(on));
    el.pumpToggleLabel.textContent = on ? "Pompa Menyala" : "Pompa Mati";
  }

  function addLog(text) {
    const li = document.createElement("li");
    const t = document.createElement("time");
    t.textContent = new Date().toLocaleTimeString("id-ID");
    const s = document.createElement("span");
    s.className = "txt";
    s.textContent = text;
    li.appendChild(t);
    li.appendChild(s);
    el.logList.prepend(li);
    while (el.logList.children.length > config.logLimit) {
      el.logList.removeChild(el.logList.lastChild);
    }
  }

  // ---- Wire MQTT events ----
  mqtt
    .on("status", renderStatus)
    .on("device", renderDevice)
    .on("telemetry", renderTelemetry)
    .on("log", addLog);

  // ---- Controls ----
  function commandPump(on) {
    const ok = mqtt.publishPump(on);
    if (ok) setPumpUI(on); // optimistic; device echo will confirm
  }

  el.pumpToggle.addEventListener("click", () => commandPump(!pumpOn));
  el.btnOn.addEventListener("click", () => commandPump(true));
  el.btnOff.addEventListener("click", () => commandPump(false));

  // ---- Broker form ----
  function fillForm() {
    $("in-url").value = config.url;
    $("in-data").value = config.dataTopic;
    $("in-cmd").value = config.commandTopic;
    $("in-user").value = config.username || "";
    $("in-pass").value = config.password || "";
    el.connUrl.textContent = config.url;
  }

  $("broker-form").addEventListener("submit", (e) => {
    e.preventDefault();
    config = {
      ...config,
      url: $("in-url").value.trim(),
      dataTopic: $("in-data").value.trim(),
      commandTopic: $("in-cmd").value.trim(),
      username: $("in-user").value.trim(),
      password: $("in-pass").value,
    };
    saveConfig(config);
    el.connUrl.textContent = config.url;
    mqtt.connect(config);
  });

  $("btn-disconnect").addEventListener("click", () => mqtt.disconnect(false));
  $("btn-clear-log").addEventListener("click", () => (el.logList.innerHTML = ""));

  // ---- Clock ----
  setInterval(() => {
    el.footClock.textContent = new Date().toLocaleTimeString("id-ID");
  }, 1000);

  // ---- Boot ----
  fillForm();
  renderStatus("idle");
  renderDevice(false);
  mqtt.connect(config);
})();
