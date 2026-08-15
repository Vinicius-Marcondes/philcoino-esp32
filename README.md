# Philcoino

[English](docs/en/README.md)

Philcoino é um protótipo local-first para monitoramento, controle de temperatura
e extração de uma máquina de espresso. O repositório reúne app Expo 54,
contrato OpenAPI, simulador determinístico e firmware ESP-IDF 6.0.2 para
ESP32-S3-WROOM-1 N16R8.

O firmware é a autoridade de sensores, targets, persistência, readiness,
timeouts, heater, pump e faults. O celular nunca participa do safety loop.

> [!CAUTION]
> O projeto não está aprovado para produção, uso sem supervisão ou testes
> energizados. A migração S3/dual-MAX6675 invalida a aplicação direta de toda
> aceitação física anterior em C3, sensor único, pump SSR ou RobotDyn. Leia
> [Segurança](docs/SAFETY.md) e o [wiring S3](docs/hardware/esp32-s3-n16r8-wiring.md).

## Geração atual

- ESP32-S3 N16R8, firmware `0.5.0`, flash 16 MB QIO/80 MHz, PSRAM desabilitada.
- API HTTPS v4 somente; API v3 não é servida.
- Novo identity/binding domain: o app precisa ser reconstruído e pareado novamente.
- MAX6675 Boiler em SCK4/SO5/CS7 e Steam em SCK4/SO8/CS9.
- Brew controla pelo Boiler; Steam controla pelo Steam; sem fallback ou blending.
- Calibrações independentes e uma única session global.
- Steam controla diretamente por `steamTargetC`; apenas ready timeout é configurável.
- RobotDyn em ZC6/DIM10, 60 Hz, LINEAR, 0% inicial e cap único de 90%.
- HX711 em DT11/SCK12 e heater SSR em GPIO21.
- CPU1 executa aquisição/controle/workflow/scale; CPU0 executa networking/OTA.

Percentuais do dimmer são comandos abstratos, não medição de tensão, potência,
pressão ou fluxo. Não existe controle fechado de pressão.

## Repositório

| Caminho | Responsabilidade |
| --- | --- |
| [`apps/mobile`](apps/mobile) | App Expo 54, discovery/pairing v4, dashboard dual, history SQLite v8 e CSV |
| [`packages/protocol`](packages/protocol) | OpenAPI v4, schemas Zod estritos, fixtures e testes |
| [`tools/device-simulator`](tools/device-simulator) | Simulador determinístico API/UI; não é evidence física |
| [`firmware/espresso-machine`](firmware/espresso-machine) | Firmware S3, adapters ESP-IDF e host tests C++ |
| [`docs`](docs) | Architecture, development, safety, hardware, PRDs e tracker |

## Desenvolvimento sem hardware

Use apenas dependências já declaradas; nenhuma instalação nova deve ser feita
sem aprovação.

```bash
EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run start
bun run simulator
```

Validação coordenada:

```bash
bun run validate:openapi
bun run test:protocol
bun run typecheck:protocol
bun run test:simulator
bun run typecheck:simulator
bun run typecheck
bun run --cwd apps/mobile test
```

Os host tests, sanitizers, contract captures e target build estão documentados
em [Development](docs/DEVELOPMENT.md). Eles não autorizam flashing nem mains.

## API v4

[`packages/protocol/openapi.yaml`](packages/protocol/openapi.yaml) é a source of
truth. A API usa SRP para pairing, HTTPS com certificate pinning e complete
acknowledged state. Calibração é sensor-qualified:

```text
/api/v4/temperature-calibrations/{boiler|steam}/current
```

`MachineStateV4` contém `boilerTemperatureC`, `steamTemperatureC`,
`temperatureCalibrations.boiler`, `.steam`, e faults térmicos com sensor de
origem. Extraction telemetry usa page format 2 e carrega ambas temperaturas.

## Documentação

- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Segurança](docs/SAFETY.md)
- [Wiring ESP32-S3 N16R8](docs/hardware/esp32-s3-n16r8-wiring.md)
- [Tracker](docs/TRACKER.md)
- [Codebase review](CODEBASE_REVIEW_REPORT.md)

Contribuições devem preservar firmware authority, fail-off outputs, validação
estrita, alterações acknowledged e os limites de safety documentados em
[CONTRIBUTING.md](CONTRIBUTING.md).
