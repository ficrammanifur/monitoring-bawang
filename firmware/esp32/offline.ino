// ==========================================
// SISTEM MONITORING KELEMBABAN TANAH
// ==========================================
// Sensor Soil  : GPIO 33 (AO)
// Relay        : GPIO 27
// LCD I2C      : SDA -> GPIO 21, SCL -> GPIO 22
// ==========================================

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ==========================================
// DEFINE PIN
// ==========================================
#define SOIL_PIN 33
#define RELAY_PIN 27

// ==========================================
// KALIBRASI SENSOR
// ==========================================
#define ADC_DRY 4095    // Nilai ADC saat kering
#define ADC_WET 1700    // Nilai ADC saat basah

// ==========================================
// INISIALISASI LCD I2C
// ==========================================
// Alamat I2C umum: 0x27 atau 0x3F
// Ukuran: 16x2 karakter
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ==========================================
// VARIABEL GLOBAL
// ==========================================
int lastMoisture = -1;  // Untuk deteksi perubahan
String lastStatus = "";

// ==========================================
// SETUP
// ==========================================
void setup() {
  // Serial Monitor
  Serial.begin(115200);
  
  // Konfigurasi pin
  pinMode(SOIL_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);  // Relay OFF saat awal
  
  // ADC 12-bit
  analogReadResolution(12);
  
  // Inisialisasi LCD
  Wire.begin();
  lcd.init();
  lcd.backlight();
  lcd.clear();
  
  // Tampilan awal LCD
  lcd.setCursor(0, 0);
  lcd.print("Soil Monitor");
  lcd.setCursor(0, 1);
  lcd.print("Initializing...");
  
  // Tampilan Serial
  Serial.println("==============================");
  Serial.println("   SOIL MOISTURE MONITOR");
  Serial.println("==============================");
  Serial.println("GPIO : 35 (Sensor)");
  Serial.println("GPIO : 33 (Relay)");
  Serial.println("LCD  : I2C (0x27)");
  Serial.println("DRY  : 4095 ADC");
  Serial.println("WET  : 1700 ADC");
  Serial.println("==============================");
  
  delay(2000);
  lcd.clear();
}

// ==========================================
// LOOP UTAMA
// ==========================================
void loop() {
  // Baca nilai ADC dari sensor
  int adcValue = analogRead(SOIL_PIN);
  
  // Konversi ADC ke persentase kelembaban
  int moisture = map(adcValue, ADC_DRY, ADC_WET, 0, 100);
  moisture = constrain(moisture, 0, 100);
  
  // Tentukan status kelembaban
  String status = getStatus(moisture);
  
  // Kontrol relay berdasarkan status
  controlRelay(status);
  
  // Tampilkan data jika ada perubahan
  if (moisture != lastMoisture || status != lastStatus) {
    // Serial Monitor
    printToSerial(adcValue, moisture, status);
    
    // LCD
    printToLCD(moisture, status);
    
    // Update variabel
    lastMoisture = moisture;
    lastStatus = status;
  }
  
  delay(1000);
}

// ==========================================
// FUNGSI: GET STATUS
// ==========================================
String getStatus(int moisture) {
  if (moisture < 55) {
    return "KERING";
  } else if (moisture < 70) {
    return "NORMAL";
  } else {
    return "BASAH";
  }
}

// ==========================================
// FUNGSI: KONTROL RELAY
// ==========================================
void controlRelay(String status) {
  // Relay ON jika tanah KERING (moisture < 55%)
  // Relay OFF jika tanah NORMAL atau BASAH
  if (status == "KERING") {
    digitalWrite(RELAY_PIN, HIGH);
  } else {
    digitalWrite(RELAY_PIN, LOW);
  }
}

// ==========================================
// FUNGSI: PRINT KE SERIAL MONITOR
// ==========================================
void printToSerial(int adcValue, int moisture, String status) {
  Serial.print("ADC: ");
  Serial.print(adcValue);
  Serial.print(" | Moisture: ");
  Serial.print(moisture);
  Serial.print("% | Status: ");
  Serial.print(status);
  Serial.print(" | Relay: ");
  Serial.println(digitalRead(RELAY_PIN) ? "ON" : "OFF");
}

// ==========================================
// FUNGSI: PRINT KE LCD 16x2
// ==========================================
void printToLCD(int moisture, String status) {
  lcd.clear();
  
  // Baris 1: Kelembaban
  lcd.setCursor(0, 0);
  lcd.print("Moisture:");
  lcd.setCursor(10, 0);
  lcd.print(moisture);
  lcd.print("%");
  
  // Baris 2: Status & Relay
  lcd.setCursor(0, 1);
  lcd.print(status);
  
  // Tambahan spasi untuk perataan
  if (status == "KERING") {
    lcd.setCursor(8, 1);
    lcd.print("Relay:ON ");
  } else {
    lcd.setCursor(8, 1);
    lcd.print("Relay:OFF");
  }
}

// ==========================================
// FUNGSI TAMBAHAN: CEK I2C ADDRESS
// (Uncomment jika perlu mendeteksi alamat LCD)
// ==========================================
/*
void scanI2C() {
  byte error, address;
  int nDevices = 0;
  
  Serial.println("Scanning I2C devices...");
  for(address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    error = Wire.endTransmission();
    
    if(error == 0) {
      Serial.print("I2C device found at address 0x");
      if(address < 16) Serial.print("0");
      Serial.print(address, HEX);
      Serial.println();
      nDevices++;
    }
  }
  if(nDevices == 0) {
    Serial.println("No I2C devices found");
  }
}
*/
