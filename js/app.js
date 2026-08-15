/* ============================================================
   app.js — glue: DOM <-> MqttService <-> TrendChart
   ============================================================ */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---- Config ----
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

  // Set thresholds
  trend.setThresholds(config.thresholdOn || 45, config.thresholdOff || 65);

  // ---- Telemetry state ----
  let pumpOn = false;
  let currentMode = "AUTO";

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
    thresholdOn: $("threshold-on"),
    thresholdOff: $("threshold-off"),
    soilPercent: $("soil-percent"),
    soilRaw: $("soil-raw"),
    soilFiltered: $("soil-filtered"),
    soilState: $("soil-state"),
    soilStatusText: $("soil-status-text"),
    soilMode: $("soil-mode"),
    tempVal: $("temp-val"),
    gaugeArc: $("gauge-arc"),
    pumpState: $("pump-state"),
    pumpToggle: $("pump-toggle"),
    pumpToggleLabel: $("pump-toggle-label"),
    btnAuto: $("btn-auto"),
    btnOn: $("btn-on"),
    btnOff: $("btn-off"),
    pumpHint: $("pump-hint"),
    chartEmpty: $("chart-empty"),
    logList: $("log-list"),
    footClock: $("foot-clock"),
  };

  const GAUGE_CIRC = 2 * Math.PI * 52;

  // ---- Rendering helpers ----
  function setDot(node, cls) {
    node.className = "dot" + (cls ? " " + cls : "");
  }

  function setActiveButton(active) {
    [el.btnAuto, el.btnOn, el.btnOff].forEach(btn => btn.classList.remove("active"));
    if (active) active.classList.add("active");
  }

  function renderStatus(state) {
    const map = {
      idle: ["", "Idle", "Idle"],
      connecting: ["warn", "Menghubungkan…", "Menghubungkan"],
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
    el.btnAuto.disabled = !connected;
    el.pumpToggle.disabled = !connected;

    if (!connected) {
      el.pumpHint.textContent = "Menunggu koneksi broker…";
    } else {
      el.pumpHint.textContent = "Mode: " + currentMode + " | Kirim ON/OFF/AUTO";
    }
  }

  function renderDevice(online) {
    setDot(el.dotDevice, online ? "on" : "off");
    setDot(el.dotDevice2, online ? "on" : "off");
    el.textDevice.textContent = online ? "ESP32 Online" : "ESP32 Offline";
    el.connDevice.textContent = online ? "Online" : "Offline";
  }

  function soilStateLabel(pct) {
    if (pct == null) return ["—", ""];
    if (pct < 30) return ["Kering", "bad"];
    if (pct < 70) return ["Normal", "good"];
    return ["Basah", "warn"];
  }

  function renderTelemetry(d) {
    // Soil moisture
    const value = d.filtered !== null ? d.filtered : d.soil;
    if (value != null) {
      const pct = Math.max(0, Math.min(100, value));
      el.soilPercent.textContent = Math.round(pct);
      el.gaugeArc.style.strokeDashoffset = GAUGE_CIRC * (1 - pct / 100);
      const [label, cls] = soilStateLabel(pct);
      el.soilState.textContent = label;
      el.soilState.className = "pill " + cls;
      el.gaugeArc.style.stroke = cls === "bad" ? "#f87171" : cls === "warn" ? "#fbbf24" : "#4ade80";
      el.soilStatusText.textContent = label;
    }

    // Raw ADC
    if (d.soilRaw != null) {
      el.soilRaw.textContent = Math.round(d.soilRaw);
    }

    // Filtered value
    if (d.filtered != null) {
      el.soilFiltered.textContent = d.filtered.toFixed(1) + "%";
    }

    // Mode
    if (d.mode) {
      currentMode = d.mode;
      el.soilMode.textContent = currentMode;
      if (currentMode === "AUTO") setActiveButton(el.btnAuto);
      else if (currentMode === "ON") setActiveButton(el.btnOn);
      else if (currentMode === "OFF") setActiveButton(el.btnOff);
    }

    // Pump state
    if (d.pump != null) {
      setPumpUI(d.pump);
    }

    // Last update
    el.connLast.textContent = new Date(d.at).toLocaleTimeString("id-ID");

    // Chart
    if (d.soil != null || d.filtered != null) {
      const chartValue = d.filtered !== null ? d.filtered : d.soil;
      if (chartValue != null) {
        trend.record(chartValue, null);
        el.chartEmpty.classList.add("hidden");
      }
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
    if (ok) {
      setPumpUI(on);
      addLog(`Perintah pompa ${on ? "ON" : "OFF"} dikirim`);
    } else {
      addLog("Gagal mengirim perintah - koneksi MQTT terputus");
    }
  }

  function commandMode(mode) {
    const ok = mqtt.publishMode(mode);
    if (ok) {
      currentMode = mode;
      el.soilMode.textContent = mode;
      addLog(`Mode diubah ke ${mode}`);
      if (mode === "AUTO") {
        setActiveButton(el.btnAuto);
        el.pumpHint.textContent = "Mode AUTO - Kontrol otomatis berdasarkan kelembaban";
      } else if (mode === "ON") {
        setActiveButton(el.btnOn);
        el.pumpHint.textContent = "Mode ON - Pompa paksa menyala";
      } else if (mode === "OFF") {
        setActiveButton(el.btnOff);
        el.pumpHint.textContent = "Mode OFF - Pompa paksa mati";
      }
    } else {
      addLog("Gagal mengirim mode - koneksi MQTT terputus");
    }
  }

  // Toggle pump
  el.pumpToggle.addEventListener("click", () => {
    if (currentMode === "AUTO") {
      addLog("Mode AUTO tidak bisa toggle manual. Gunakan tombol ON/OFF.");
      return;
    }
    commandPump(!pumpOn);
  });

  // Mode buttons
  el.btnAuto.addEventListener("click", () => commandMode("AUTO"));
  el.btnOn.addEventListener("click", () => {
    commandMode("ON");
    commandPump(true);
  });
  el.btnOff.addEventListener("click", () => {
    commandMode("OFF");
    commandPump(false);
  });

  // ---- Broker form ----
  function fillForm() {
    $("in-url").value = config.url;
    $("in-data").value = config.dataTopic;
    $("in-cmd").value = config.commandTopic;
    $("in-user").value = config.username || "";
    $("in-pass").value = config.password || "";
    el.connUrl.textContent = config.url;
    el.thresholdOn.textContent = (config.thresholdOn || 45) + "%";
    el.thresholdOff.textContent = (config.thresholdOff || 65) + "%";
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
