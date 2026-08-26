REDMOND SkyKettle RK-G211S for Homey

Unofficial local Homey app for controlling the REDMOND SkyKettle RK-G211S
through an ESP32-C5 Bluetooth LE to Zigbee bridge.

Tested with the ESP32-C5 firmware on Athom Homey Pro (2023).

ESP32-C5 firmware, source code and setup guide:
https://github.com/edsallo/redmond-kettle-esp32c5-zigbee

Features:
- current water temperature;
- normal boiling to 100 °C;
- arbitrary target temperature from 40 to 100 °C;
- presets for 40, 55, 70 and 85 °C;
- configurable temperature holding time;
- automatic reconnection after the kettle is returned to its base;
- autonomous temperature-dependent kettle lighting.
