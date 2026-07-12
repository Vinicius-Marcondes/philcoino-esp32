# Como contribuir com o Philcoino

[English](docs/en/CONTRIBUTING.md)

Obrigado por ajudar a melhorar o Philcoino. Este repositório envolve rede mobile, um contrato HTTP, firmware embarcado e controle de temperatura próximo à rede elétrica. Uma boa contribuição mantém visíveis as responsabilidades e boundaries de segurança.

> [!IMPORTANT]
> Philcoino é um protótipo e não está aprovado para produção, uso sem supervisão ou operação do heater ligado à rede elétrica. Leia [docs/SAFETY.md](docs/SAFETY.md) e os [findings da revisão atual](CODEBASE_REVIEW_REPORT.md) antes de alterar firmware, control logic, sensores, comportamento do SSR, segurança de rede ou orientações de hardware.

## Antes de começar

1. Leia a [visão geral do projeto](README.md), [Architecture](docs/ARCHITECTURE.md) e o guia de [Development](docs/DEVELOPMENT.md).
2. Consulte [docs/TRACKER.md](docs/TRACKER.md) e a PRD/task relevante. A presença de código não significa aceitação humana.
3. Leia as decisões e os documentos de protocolo, hardware, referências e side notes relacionados.
4. Antes de qualquer operação Git, leia [docs/GIT_RULES.md](docs/GIT_RULES.md).
5. Para mudanças assistidas por AI, siga [AGENTS.md](AGENTS.md).

Converse antes quando uma mudança afetar o escopo do produto, compatibilidade da API, hardware físico, premissas de segurança, dados persistidos ou comportamento de safety. Nunca presuma autorização para testes energizados.

## Configuração do ambiente de desenvolvimento

Os workspaces TypeScript usam Bun. Expo SDK 54 exige Node.js 20.19 ou mais recente. Instale as dependências declaradas somente depois de revisar qualquer alteração no manifest:

```bash
bun install
```

O firmware é independente e está fixado em ESP-IDF 6.0.2 / ESP32-C3. Os host tests exigem CMake e um compilador C++17; target builds exigem o ambiente ESP-IDF fixado. Consulte [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) para os workflows exatos.

Não faça commit de valores `.env`, bearer tokens, credenciais Wi-Fi, `sdkconfig`, projetos nativos gerados, diretórios de dependências, build output, caches, coverage ou bancos de dados locais.

## Escolha a boundary responsável

- Routes e navigation pertencem a `apps/mobile/app`; UI reutilizável pertence a `apps/mobile/components`.
- Discovery, pairing, networking, storage, polling e orchestration de mutations permanecem nas boundaries existentes em `apps/mobile/src/*`.
- Mudanças na API começam em `packages/protocol/openapi.yaml`.
- Comportamento determinístico de contrato/UI pertence a `tools/device-simulator`; controles exclusivos do simulador permanecem sob `/_simulator`.
- Policy pura do firmware pertence a componentes testáveis no host. Chamadas ESP-IDF permanecem nos adapters `esp_*` ou no wiring de `main`.
- Afirmações sobre produto, architecture, development e safety pertencem a `docs` e devem corresponder ao source atual.

Evite criar uma nova abstraction quando já existe uma boundary responsável. Mantenha funções novas pequenas, com uma única responsabilidade e próximas de seus consumidores.

## Alterando a API

Trate uma mudança de API como uma alteração coordenada:

1. Atualize `packages/protocol/openapi.yaml`.
2. Alinhe schemas/types Zod e fixtures válidas/inválidas.
3. Atualize o tratamento de requests e responses no simulador.
4. Atualize o cliente mobile, error mapping e as sessions/UI afetadas.
5. Atualize parsing, serialization e route registration do firmware de forma independente em C++.
6. Amplie os testes de contrato, simulador, mobile e captures do firmware.
7. Atualize os documentos de protocolo e architecture destinados a pessoas.

Propriedades desconhecidas são rejeitadas. Não enfraqueça a validação em runtime para absorver drift silenciosamente.

## Preservando o comportamento em runtime

- O firmware é responsável por sensores, validação de targets, persistência NVS, readiness, timeouts, permissão/saída do heater e faults.
- Mutations mobile devem permanecer pending até um acknowledgement válido. Nunca publique de forma otimista um mode, target ou heater state solicitado como estado real.
- Pause o polling enquanto uma mutation estiver em andamento e ignore trabalho obsoleto após mudanças de cancellation/generation.
- Limpe snapshots reais quando a conexão ficar indisponível; não apresente valores em cache como estado atual da máquina.
- Preserve a semântica de first cause entre timeout e cancellation solicitada pelo caller.
- Preserve o tempo manual determinístico no simulador. Não afirme que o simulador representa o duty loop em tempo real ou a resposta de segurança do firmware.
- Caminhos de falha do firmware devem tentar comandar o SSR para off, mas a documentação não deve equiparar um comando de software à desenergização física confirmada.

## Validação

Execute os checks de toda área afetada, não apenas do package editado. A matriz completa de comandos está em [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

No mínimo:

| Área alterada | Checks obrigatórios |
| --- | --- |
| Mobile | mobile typecheck, tests e lint; exercitar o comportamento native/web afetado quando aplicável |
| Protocol | validação OpenAPI, protocol typecheck/tests e checks de todos os packages dependentes |
| Simulator | simulator typecheck/tests mais os checks de protocolo |
| Firmware policy/API | native host build/tests e validação dos contract captures |
| ESP-IDF adapters/config | host checks mais o `idf.py build` fixado quando o toolchain estiver disponível |
| Documentation | comandos e afirmações conferidos contra manifests/source; links Markdown locais verificados |

Informe os checks que não puderam ser executados. Testes aprovados no simulador ou host não representam aceitação do hardware físico.

## Pull requests

Mantenha um objetivo claro por pull request e use o GitHub Connector ou `gh` para criá-lo. Inclua:

- o que mudou e por quê;
- packages e runtime flows afetados;
- impacto na compatibilidade da API e em dados persistidos;
- impacto em safety ou hardware;
- verificação automatizada e manual, incluindo omissões;
- premissas, checks humanos adiados e blockers restantes;
- documentação atualizada com o comportamento.

Nunca faça push direto para `master`, descarte trabalho não relacionado ou inclua output gerado/de dependências.
