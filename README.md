# Приложение REDMOND SkyKettle RK-G211S для Homey

Неофициальное локальное приложение для управления чайником REDMOND SkyKettle
RK-G211S через Zigbee-мост ESP32-C5.

Приложение совместно с прошивкой ESP32-C5 протестировано на **Athom Homey Pro
(2023)**.

## Загрузка и установка

- **[Скачать приложение Homey v1.0.1](https://github.com/edsallo/homey-redmond-skykettle-zigbee/releases/download/v1.0.1/com.redmond.kettle-homey-v1.0.1.zip)**
- **[Подробная инструкция по установке](INSTALL-HOMEY.md)**

## Необходимая прошивка ESP32-C5

Для работы приложения требуется отдельный Zigbee-мост ESP32-C5. Прошивка,
готовый BIN-файл и инструкция опубликованы в самостоятельном репозитории:

**[edsallo/redmond-kettle-esp32c5-zigbee](https://github.com/edsallo/redmond-kettle-esp32c5-zigbee)**

## Возможности приложения

- текущая температура воды;
- обычное кипячение до 100 °C;
- произвольная температура от 40 до 100 °C;
- кнопки 40, 55, 70 и 85 °C;
- поддержание температуры с настраиваемым временем от 1 до 15 минут;
- автоматическое восстановление связи после возврата чайника на базу;
- локальная работа без облака REDMOND.
- Flow-триггер «Чайник закипел и выключился» с тегом температуры воды.

## Разработка

Zigbee-драйвер находится в [`drivers/kettle_zigbee`](drivers/kettle_zigbee).

```bash
npm install
npm run build
homey app install
```
