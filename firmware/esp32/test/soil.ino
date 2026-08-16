// ==========================================
// SOIL MOISTURE - VOLTAGE CALIBRATION
// AO -> GPIO 35
// VCC -> 3.3V
// GND -> GND
// ==========================================

#define SOIL_PIN 35

// ==========================================
// HASIL KALIBRASI SENSOR
// ==========================================

#define VOLT_DRY  2.453
#define VOLT_WET  1.440

// ==========================================
// BATAS STATUS
// ==========================================

#define DRY_LIMIT  2.40
#define WET_LIMIT  1.60


void setup() {

  Serial.begin(115200);

  pinMode(SOIL_PIN, INPUT);

  analogReadResolution(12);

  Serial.println();
  Serial.println("================================");
  Serial.println("   SOIL MOISTURE CALIBRATION");
  Serial.println("================================");
  Serial.println("GPIO      : 35");
  Serial.println("VCC       : 3.3V");
  Serial.println("DRY       : 2.453 V");
  Serial.println("WET       : 1.440 V");
  Serial.println("DRY LIMIT : 2.400 V");
  Serial.println("WET LIMIT : 1.600 V");
  Serial.println("================================");

  delay(1000);
}


void loop() {

  // ========================================
  // BACA ADC
  // ========================================

  int adcValue = analogRead(SOIL_PIN);


  // ========================================
  // ADC -> VOLTAGE
  // ========================================

  float voltage =
    (adcValue / 4095.0) * 3.3;


  // ========================================
  // VOLTAGE -> MOISTURE %
  //
  // 2.453 V = 0%
  // 1.440 V = 100%
  // ========================================

  float moisture =
    ((VOLT_DRY - voltage) /
     (VOLT_DRY - VOLT_WET)) * 100.0;

  moisture = constrain(
    moisture,
    0,
    100
  );


  // ========================================
  // STATUS
  // ========================================

  String status;

  if (voltage >= DRY_LIMIT) {

    status = "KERING";

  }
  else if (voltage <= WET_LIMIT) {

    status = "BASAH";

  }
  else {

    status = "NORMAL";
  }


  // ========================================
  // SERIAL MONITOR
  // ========================================

  Serial.print("ADC: ");
  Serial.print(adcValue);

  Serial.print(" | Voltage: ");
  Serial.print(voltage, 3);
  Serial.print(" V");

  Serial.print(" | Moisture: ");
  Serial.print(moisture, 1);
  Serial.print("%");

  Serial.print(" | Status: ");
  Serial.println(status);


  delay(1000);
}
