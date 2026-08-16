#include <WiFi.h>
#include <WiFiClient.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WiFiManager.h>  // Tambahkan library WiFiManager

// =====================================================
// KONFIGURASI SISTEM
// =====================================================

// ---- MQTT (Tetap hardcode atau bisa juga dimasukkan ke WiFiManager) ----
const char* MQTT_BROKER = "broker.hivemq.com";
const int MQTT_PORT = 1883;
#define MQTT_BASE "hydroponic/habib"
#define TOPIC_SENSOR_SOIL      MQTT_BASE "/sensor/soil"
#define TOPIC_SENSOR_MOISTURE  MQTT_BASE "/sensor/moisture"
#define TOPIC_SENSOR_ALL       MQTT_BASE "/sensor/all"
#define TOPIC_CONTROL_RELAY    MQTT_BASE "/control/relay"
#define TOPIC_STATUS_RELAY     MQTT_BASE "/status/relay"
#define TOPIC_STATUS_DEVICE    MQTT_BASE "/status/device"

// ---- Hardware ----
#define SOIL_PIN 35
#define RELAY_PIN 14
#define SDA_PIN 21
#define SCL_PIN 22

// ---- Kalibrasi Soil ----
#define ADC_DRY 4095
#define ADC_WET 1700

// ---- Hysteresis Threshold ----
#define HYSTERESIS_OFF 45   // Pompa OFF saat >= 45% (tanah sudah cukup basah)
#define HYSTERESIS_ON  25   // Pompa ON saat <= 25% (tanah kering)

// ---- Relay ----
#define RELAY_ON  LOW
#define RELAY_OFF HIGH

// ---- Timing ----
#define MQTT_PUBLISH_INTERVAL 2000
#define SENSOR_SAMPLE_INTERVAL 500

// ---- Moving Average ----
#define MOVING_AVERAGE_SIZE 10

// =====================================================
// GLOBAL OBJECTS
// =====================================================
WiFiClient espClient;
PubSubClient mqttClient(espClient);
LiquidCrystal_I2C lcd(0x27, 16, 2);

// WiFiManager
WiFiManager wifiManager;

// =====================================================
// GLOBAL STATE
// =====================================================
enum RelayMode {
  MODE_AUTO,
  MODE_ON,
  MODE_OFF
};

RelayMode relayMode = MODE_AUTO;
bool pumpState = false;
bool lastPumpState = false;
unsigned long lastPublish = 0;
unsigned long lastSensorRead = 0;
bool wifiManagerStarted = false;

// Moving Average Buffer
int adcBuffer[MOVING_AVERAGE_SIZE];
int bufferIndex = 0;
int bufferCount = 0;

// Sensor Data
struct SensorData {
  int adc;
  int moisture;
  float filteredMoisture;
  String status;
  bool isDry;
};

SensorData sensorData;

// =====================================================
// MOVING AVERAGE FILTER
// =====================================================
float movingAverageFilter(int newAdc) {
  adcBuffer[bufferIndex] = newAdc;
  bufferIndex = (bufferIndex + 1) % MOVING_AVERAGE_SIZE;
  if (bufferCount < MOVING_AVERAGE_SIZE) bufferCount++;
  
  long sum = 0;
  for (int i = 0; i < bufferCount; i++) {
    sum += adcBuffer[i];
  }
  
  return (float)sum / bufferCount;
}

// =====================================================
// HYSTERESIS CONTROL - DIPERBAIKI
// =====================================================
bool hysteresisControl(float moisture, bool currentState) {
  // Logika yang benar:
  // - Jika moisture <= HYSTERESIS_ON (25%): tanah KERING → Pompa ON
  // - Jika moisture >= HYSTERESIS_OFF (45%): tanah BASAH → Pompa OFF
  // - Di antara 25-45%: pertahankan kondisi sebelumnya (hysteresis)
  
  if (moisture <= HYSTERESIS_ON) {
    return true;  // KERING → Pompa ON
  } else if (moisture >= HYSTERESIS_OFF) {
    return false; // BASAH → Pompa OFF
  } else {
    return currentState; // Zona mati, pertahankan kondisi
  }
}

// =====================================================
// UPDATE SENSOR
// =====================================================
void updateSensor() {
  int rawAdc = analogRead(SOIL_PIN);
  float filteredAdc = movingAverageFilter(rawAdc);
  
  int moisture = map(rawAdc, ADC_DRY, ADC_WET, 0, 100);
  moisture = constrain(moisture, 0, 100);
  
  float filteredMoisture = map((int)filteredAdc, ADC_DRY, ADC_WET, 0, 100);
  filteredMoisture = constrain(filteredMoisture, 0, 100);
  
  sensorData.adc = rawAdc;
  sensorData.moisture = moisture;
  sensorData.filteredMoisture = filteredMoisture;
  
  // Status berdasarkan threshold yang benar
  if (filteredMoisture <= HYSTERESIS_ON) {
    sensorData.status = "KERING";
    sensorData.isDry = true;
  } else if (filteredMoisture >= HYSTERESIS_OFF) {
    sensorData.status = "BASAH";
    sensorData.isDry = false;
  } else {
    sensorData.status = "NORMAL";
    sensorData.isDry = false;
  }
}

// =====================================================
// CONTROL PUMP - DIPERBAIKI
// =====================================================
void controlPump() {
  bool newPumpState = pumpState;
  
  if (relayMode == MODE_AUTO) {
    // Mode AUTO: gunakan hysteresis control
    newPumpState = hysteresisControl(sensorData.filteredMoisture, pumpState);
  } else if (relayMode == MODE_ON) {
    // Mode FORCE ON
    newPumpState = true;
  } else if (relayMode == MODE_OFF) {
    // Mode FORCE OFF
    newPumpState = false;
  }
  
  // Update relay
  digitalWrite(RELAY_PIN, newPumpState ? RELAY_ON : RELAY_OFF);
  
  // Log perubahan
  if (newPumpState != lastPumpState) {
    lastPumpState = newPumpState;
    pumpState = newPumpState;
    Serial.print("[Pump] ");
    Serial.print(pumpState ? "ON" : "OFF");
    Serial.print(" | Moisture: ");
    Serial.print(sensorData.filteredMoisture, 1);
    Serial.print("% | Status: ");
    Serial.println(sensorData.status);
  }
}

// =====================================================
// MQTT CALLBACK
// =====================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  message.trim();
  message.toUpperCase();

  Serial.println("\n[MQTT] Command received");
  Serial.print("  Topic: ");
  Serial.println(topic);
  Serial.print("  Payload: ");
  Serial.println(message);

  if (String(topic) == TOPIC_CONTROL_RELAY) {
    if (message == "ON") {
      relayMode = MODE_ON;
      pumpState = true;
      digitalWrite(RELAY_PIN, RELAY_ON);
      Serial.println("[Control] Relay Mode: FORCE ON");
    }
    else if (message == "OFF") {
      relayMode = MODE_OFF;
      pumpState = false;
      digitalWrite(RELAY_PIN, RELAY_OFF);
      Serial.println("[Control] Relay Mode: FORCE OFF");
    }
    else if (message == "AUTO") {
      relayMode = MODE_AUTO;
      // Kembali ke mode auto, langsung update berdasarkan sensor
      pumpState = hysteresisControl(sensorData.filteredMoisture, pumpState);
      digitalWrite(RELAY_PIN, pumpState ? RELAY_ON : RELAY_OFF);
      Serial.println("[Control] Relay Mode: AUTO");
    }
  }
}

// =====================================================
// PUBLISH SENSOR DATA
// =====================================================
void publishSensorData() {
  if (!mqttClient.connected()) {
    return;
  }

  char adcPayload[20];
  sprintf(adcPayload, "%d", sensorData.adc);
  mqttClient.publish(TOPIC_SENSOR_SOIL, adcPayload);

  char moisturePayload[20];
  sprintf(moisturePayload, "%.1f", sensorData.filteredMoisture);
  mqttClient.publish(TOPIC_SENSOR_MOISTURE, moisturePayload);

  const char* relayPayload = pumpState ? "ON" : "OFF";
  mqttClient.publish(TOPIC_STATUS_RELAY, relayPayload, true);

  char jsonPayload[300];
  snprintf(jsonPayload, sizeof(jsonPayload),
    "{\"adc\":%d,\"moisture\":%d,\"filtered\":%.1f,\"status\":\"%s\",\"relay\":\"%s\",\"mode\":\"%s\"}",
    sensorData.adc,
    sensorData.moisture,
    sensorData.filteredMoisture,
    sensorData.status.c_str(),
    relayPayload,
    relayMode == MODE_AUTO ? "AUTO" : relayMode == MODE_ON ? "ON" : "OFF"
  );

  mqttClient.publish(TOPIC_SENSOR_ALL, jsonPayload);
  
  Serial.println("[MQTT] Data published");
  Serial.print("  JSON: ");
  Serial.println(jsonPayload);
}

// =====================================================
// UPDATE LCD
// =====================================================
void updateLCD() {
  lcd.setCursor(0, 0);
  
  if (WiFi.status() == WL_CONNECTED) {
    lcd.print("Mois:");
    lcd.print(sensorData.filteredMoisture, 1);
    lcd.print("%  ");
  } else {
    lcd.print("WiFi Config  ");
  }
  
  lcd.setCursor(0, 1);
  
  if (!wifiManagerStarted && WiFi.status() != WL_CONNECTED) {
    lcd.print("AP: Hydroponic");
    return;
  }
  
  if (sensorData.status == "KERING") {
    lcd.print("KERING");
  } else if (sensorData.status == "NORMAL") {
    lcd.print("NORMAL");
  } else {
    lcd.print("BASAH ");
  }
  
  lcd.print(" ");
  lcd.print(pumpState ? "P:ON " : "P:OFF");
  
  if (relayMode == MODE_AUTO) {
    lcd.print("A");
  } else if (relayMode == MODE_ON) {
    lcd.print("M");
  } else {
    lcd.print("F");
  }
}

// =====================================================
// WIFI MANAGER - Setup dan koneksi
// =====================================================
void setupWiFiManager() {
  Serial.println("[WiFiManager] Memulai WiFi Manager...");
  
  // Set timeout untuk konfigurasi (120 detik)
  wifiManager.setConfigPortalTimeout(120);
  
  // Set nama access point dan password (opsional)
  // Jika password dikosongkan, AP akan terbuka (tanpa password)
  String apName = "Hydroponic-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  
  // Tampilkan di LCD bahwa WiFi Manager aktif
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi Config");
  lcd.setCursor(0, 1);
  lcd.print("AP: Hydroponic");
  
  Serial.print("[WiFiManager] AP Name: ");
  Serial.println(apName);
  Serial.println("[WiFiManager] Connect to this AP and browse to 192.168.4.1");
  
  // Reset settings - hapus semua kredensial yang tersimpan (opsional)
  // wifiManager.resetSettings();
  
  // AutoConnect - mencoba koneksi dengan kredensial yang tersimpan
  // Jika gagal, akan membuat AP untuk konfigurasi
  bool connected = wifiManager.autoConnect(apName.c_str());
  
  if (connected) {
    wifiManagerStarted = false;
    Serial.println("[WiFiManager] Berhasil terhubung ke WiFi!");
    Serial.print("[WiFi] IP Address: ");
    Serial.println(WiFi.localIP());
    
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi OK");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP().toString());
    delay(2000);
    lcd.clear();
  } else {
    // Jika gagal, coba lagi (reset dan restart)
    Serial.println("[WiFiManager] Gagal terhubung. Memulai ulang...");
    wifiManagerStarted = false;
    ESP.restart();
  }
}

// =====================================================
// MQTT CONNECTION
// =====================================================
void connectMQTT() {
  if (mqttClient.connected()) return;
  if (WiFi.status() != WL_CONNECTED) return;
  
  Serial.println("[MQTT] Connecting...");
  
  String clientId = "ESP32-HABIB-";
  clientId += String((uint32_t)ESP.getEfuseMac(), HEX);

  if (mqttClient.connect(clientId.c_str())) {
    Serial.println("[MQTT] Connected!");
    mqttClient.subscribe(TOPIC_CONTROL_RELAY);
    mqttClient.publish(TOPIC_STATUS_DEVICE, "ONLINE", true);
    mqttClient.publish(TOPIC_STATUS_RELAY, "OFF", true);
  } else {
    Serial.print("[MQTT] Failed, state: ");
    Serial.println(mqttClient.state());
  }
}

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  
  // ---- Hardware Setup ----
  pinMode(SOIL_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);
  
  Wire.begin(SDA_PIN, SCL_PIN);
  lcd.init();
  lcd.backlight();
  lcd.clear();
  
  // ---- Display Splash ----
  lcd.setCursor(0, 0);
  lcd.print("HYDROPONIC SYS");
  lcd.setCursor(0, 1);
  lcd.print("HABIB");
  delay(1500);
  
  // ---- Serial Info ----
  Serial.println();
  Serial.println("==========================================");
  Serial.println("    HYDROPONIC SYSTEM with WiFi Manager");
  Serial.println("==========================================");
  Serial.println("Hardware:");
  Serial.println("  Soil      : GPIO 35");
  Serial.println("  Relay     : GPIO 14");
  Serial.println("  LCD       : I2C 0x27");
  Serial.println();
  Serial.println("Control Algorithm:");
  Serial.println("  [1] Moving Average Filter  : " + String(MOVING_AVERAGE_SIZE) + " samples");
  Serial.println("  [2] Hysteresis Control     : ON=" + String(HYSTERESIS_ON) + "%, OFF=" + String(HYSTERESIS_OFF) + "%");
  Serial.println("  [3] Finite State Machine   : AUTO / ON / OFF");
  Serial.println("==========================================");
  Serial.println();
  
  // ---- WiFi Manager ----
  wifiManagerStarted = true;
  setupWiFiManager();
  
  // ---- MQTT Setup ----
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);
  
  connectMQTT();
  
  lcd.clear();
}

// =====================================================
// LOOP - Simple Non-blocking
// =====================================================
void loop() {
  unsigned long now = millis();
  
  // ---- Cek WiFi ----
  if (WiFi.status() != WL_CONNECTED) {
    // Jika WiFi putus, coba reconnect
    Serial.println("[WiFi] Koneksi hilang, mencoba reconnect...");
    WiFi.reconnect();
    delay(1000);
    
    // Jika masih tidak terhubung, restart WiFi Manager
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Gagal reconnect, memulai WiFi Manager...");
      wifiManagerStarted = true;
      setupWiFiManager();
    }
  }
  
  // ---- MQTT ----
  if (!mqttClient.connected()) {
    connectMQTT();
  }
  mqttClient.loop();
  
  // ---- Sensor ----
  if (now - lastSensorRead >= SENSOR_SAMPLE_INTERVAL) {
    lastSensorRead = now;
    updateSensor();
    
    // Serial monitor
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("ADC: ");
      Serial.print(sensorData.adc);
      Serial.print(" | Moisture: ");
      Serial.print(sensorData.filteredMoisture, 1);
      Serial.print("% | Status: ");
      Serial.print(sensorData.status);
      Serial.print(" | Relay: ");
      Serial.print(pumpState ? "ON" : "OFF");
      Serial.print(" | Mode: ");
      Serial.println(relayMode == MODE_AUTO ? "AUTO" : relayMode == MODE_ON ? "ON" : "OFF");
    }
  }
  
  // ---- Control ----
  controlPump();
  
  // ---- LCD (update setiap 200ms) ----
  static unsigned long lastLCD = 0;
  if (now - lastLCD >= 200) {
    lastLCD = now;
    updateLCD();
  }
  
  // ---- MQTT Publish ----
  if (now - lastPublish >= MQTT_PUBLISH_INTERVAL) {
    lastPublish = now;
    publishSensorData();
  }
  
  // ---- Delay kecil untuk stabilitas ----
  delay(10);
}
