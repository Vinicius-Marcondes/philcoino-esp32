# Philcoino

[English](docs/en/README.md)

Philcoino é um protótipo local-first para monitoramento, controle de temperatura e comando de extração de uma máquina de espresso. O repositório reúne um aplicativo mobile em Expo, um contrato OpenAPI, um simulador determinístico do dispositivo e firmware para ESP32-C3.

O celular descobre e autentica uma máquina, exibe o estado em tempo real e envia alterações de target, mode e permissão do heater. O ESP32 continua sendo a autoridade sobre leituras dos sensores, targets persistidos, readiness, saída do heater, timeouts e faults.

> [!CAUTION]
> Este projeto não está aprovado para produção ou uso sem supervisão. Em
> 2026-07-16, o owner aceitou uma configuração testada após checks funcionais e
> dos controles de energia com equipamento técnico; isso não é certificação nem
> autorização geral para outra configuração energizada. Para desenvolvimento,
> use o simulador ou hardware em baixa tensão, leia
> [Segurança e status do projeto](docs/SAFETY.md) e preserve os findings abertos.

## O que está implementado

- Descoberta local no iOS/Android por mDNS `_philcoino._tcp`, com endereço manual como fallback.
- Inspeção pública da identidade do dispositivo seguida de autenticação por bearer token.
- Armazenamento seguro de um dispositivo selecionado, token e último endereço válido.
- Restauração pelo endereço salvo e redescoberta por stable ID após mudanças de endereço.
- Validação estrita das APIs v1/v2 em runtime e estados explícitos para offline, unauthorized, not found, timeout e protocol error.
- Polling do dashboard a cada segundo, orientado à conclusão, enquanto a tela e o app estão ativos.
- Histórico atual em SQLite com backfill automático de até dez minutos do
  buffer RAM do ESP32 e Live paginado em janelas horizontais de 30 s.
- Targets de brew/steam, active mode, permissão do heater e dismissal de over-temperature confirmados pelo firmware.
- Controle pelo ESP32-C3, persistência dos targets em NVS, amostragem MAX6675, saída SSD1306, rede HTTP/mDNS e policy boundaries testáveis no host.
- Simulador determinístico Bun/Hono para desenvolvimento mobile e do contrato.
- Profiles locais Manual + quatro slots, export completo e extração reconhecida
  pelo firmware com pre-infusion, soak, main, Stop e cutoff Manual de 60 s.

O produto ainda é um protótipo. A aceitação da PRD-001 e a validação física estão incompletas; consulte o [tracker](docs/TRACKER.md) e os [findings conhecidos](CODEBASE_REVIEW_REPORT.md).

## Visão geral do sistema

```text
Expo mobile app
  discovery -> identity check -> bearer authentication -> SecureStore
      |                                                   |
      +-------------- local HTTP API v1 + v2 ------------+
                              |
                    ESP32 firmware (authority)
             sensors -> control -> SSR command -> faults
                              |
                         NVS targets

OpenAPI 3.1.1 contract
  -> strict Zod schemas (mobile + simulator)
  -> independent strict C++ validation (firmware)

Device simulator
  -> contract/UI development only; not a firmware safety model
```

Para entender ownership e fluxos de falha em detalhes, leia [Architecture](docs/ARCHITECTURE.md).

## Estrutura do repositório

| Caminho | Responsabilidade |
| --- | --- |
| [`apps/mobile`](apps/mobile) | Cliente Expo 54 / React Native, discovery, pairing, persistência segura, polling, controles e UI |
| [`packages/protocol`](packages/protocol) | Contrato OpenAPI autoritativo, schemas Zod estritos, fixtures e contract tests |
| [`tools/device-simulator`](tools/device-simulator) | Simulador determinístico da API em Bun/Hono e controles de desenvolvimento |
| [`firmware/espresso-machine`](firmware/espresso-machine) | Firmware independente em ESP-IDF 6.0.2 e host tests nativos |
| [`docs`](docs) | Architecture, desenvolvimento, segurança, PRD, hardware, decisões e referências |

O workspace Bun inclui `apps/*`, `packages/*` e `tools/*`. O firmware tem seu próprio toolchain CMake/ESP-IDF e, intencionalmente, não faz parte do workspace Bun.

## Início rápido sem hardware

Pré-requisitos:

- Bun compatível com o lockfile versionado;
- Node.js 20.19 ou mais recente para Expo SDK 54;
- dependências do workspace instaladas (`bun install`) antes de executar os comandos.

Nenhuma dependência adicional é necessária além do manifest do repositório. A partir da raiz:

```bash
bun install
EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run start
```

O debug-device mode renderiza o dashboard sem discovery, autenticação, requests de rede ou ESP32. Ele é útil para trabalhar na UI, mas as temperaturas e o uptime permanecem estáticos.

Para desenvolver a API e integrações, execute o simulador determinístico:

```bash
bun run simulator
```

Por padrão, ele escuta em `http://localhost:3000` e usa o bearer token de desenvolvimento `philcoino-dev-token`. No aplicativo, informe manualmente o endereço do simulador. A descoberta na rede local exige um development build nativo para iOS/Android; web e plataformas sem suporte usam endereço manual.

Consulte [Development](docs/DEVELOPMENT.md) para workflows das plataformas, controles do simulador, configuração do firmware e a matriz completa de verificação.

## Contrato da API

[`packages/protocol/openapi.yaml`](packages/protocol/openapi.yaml) é a source of truth do protocolo. Os endpoints públicos são:

- `GET /healthz`
- `GET /api/v1/device`

Endpoints autenticados exigem `Authorization: Bearer <token>`:

- `GET /api/v1/state`
- `PATCH /api/v1/settings/temperatures`
- `PUT /api/v1/mode`
- `PUT /api/v1/heater`
- `POST /api/v1/faults/over-temperature/dismiss`

A API v2 adiciona, sem remover v1:

- `GET /api/v2/state`
- `GET /api/v2/history`
- `GET` e `PUT /api/v2/profiles`
- `POST /api/v2/extractions/start`
- `POST /api/v2/extractions/stop`
- `POST /api/v2/cooldowns/start`
- `POST /api/v2/cooldowns/stop`

Valores históricos e atuais `running`/`off` indicam somente comandos do
firmware, não corrente, fluxo,
posição do switch em série ou desenergização física confirmada.

O simulador também disponibiliza controles `_simulator/*`, que ficam deliberadamente fora da API v1 e nunca devem ser implementados como endpoints do firmware de produção.

## Regras centrais de design

- O firmware, não o celular, é responsável pelo loop de tempo real e segurança.
- Alterações solicitadas não aparecem como estado real até chegar um acknowledgement válido do firmware.
- O polling pausa durante uma mutation para impedir que um snapshot antigo sobrescreva o acknowledgement.
- Todo payload de discovery, storage, request, response e error é validado na sua boundary.
- Snapshots de fault informam o comando do heater como inativo; a certeza sobre a saída física ainda depende do hardware e dos findings de segurança não resolvidos.
- O simulador ajuda nos testes de contrato/UI e não comprova que o timing ou o controle do heater no firmware sejam seguros.

## Documentação

- [Índice da documentação](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development e verificação](docs/DEVELOPMENT.md)
- [Segurança e status do projeto](docs/SAFETY.md)
- [Como contribuir](CONTRIBUTING.md)
- [Descrição da API v1](docs/protocol/api-v1-outline.md)
- [Descrição da API v2](docs/protocol/api-v2-outline.md)
- [Ligação do hardware](docs/hardware/esp32-c3-wiring.md)
- [Ajuste do controle de temperatura](docs/hardware/temperature-control-tuning.md)
- [Tracker da PRD-001](docs/TRACKER.md)
- [Findings da revisão do codebase](CODEBASE_REVIEW_REPORT.md)

## Como contribuir

Comece por [CONTRIBUTING.md](CONTRIBUTING.md). Mudanças na API, controle do firmware, comportamento do hardware, autenticação ou dados persistidos exigem revisão end-to-end de todas as boundaries afetadas. Nunca inclua secrets locais, projetos nativos gerados, diretórios de dependências, build output do firmware ou `sdkconfig` em uma contribuição.
