# Documentação do Philcoino

[English](en/DOCUMENTATION.md)

Este diretório explica o sistema Philcoino implementado, o escopo aprovado do produto e o trabalho de segurança que ainda está incompleto. Leia os documentos conforme sua autoridade, sem presumir que todo plano histórico descreve o código atual.

## Idiomas

- Português do Brasil é o idioma padrão dos documentos gerais para leitores: visão do projeto, contribuição, índice e segurança.
- As versões equivalentes em inglês ficam em [`docs/en`](en).
- Documentos técnicos voltados a software engineers e AI agents permanecem em inglês nos caminhos atuais, incluindo Architecture, Development, protocolo, hardware, PRDs, tracker, referências e regras Git.
- Quando um comportamento público mudar, atualize as versões em português e inglês na mesma alteração.

## Comece por aqui

| Documento | Quando usar |
| --- | --- |
| [README do projeto](../README.md) | Visão pública, capacidades atuais e início rápido com simulador/debug |
| [Architecture](ARCHITECTURE.md) | Componentes em runtime, ownership, data flows, state transitions e comportamento de falha |
| [Development](DEVELOPMENT.md) | Pré-requisitos, workflows dos packages, controles do simulador, configuração do firmware e verificação |
| [Segurança](SAFETY.md) | Restrições do protótipo, riscos conhecidos de software/hardware e boundary de aceitação física |
| [Como contribuir](../CONTRIBUTING.md) | Processo de mudança, workflow do contrato, expectativas de validação e checklist de pull request |
| [Tracker da PRD-001](TRACKER.md) | Estado supervisionado das tasks, evidências, aprovações e trabalho ainda aguardando aceitação |
| [Revisão do codebase](../CODEBASE_REVIEW_REPORT.md) | Findings atuais detalhados de BLOCKER/MAJOR/MINOR e resultados dos quality gates |

## Sources of truth

Quando os documentos divergirem, use esta ordem:

1. `packages/protocol/openapi.yaml` para o contrato HTTP no wire.
2. Source e testes atuais para o comportamento implementado em runtime.
3. Decisões aprovadas em `docs/decisions` e a PRD ativa para as boundaries pretendidas.
4. `docs/TRACKER.md` para aceitação supervisionada das tasks — não apenas para saber se o código existe.
5. Documentos de hardware e side notes para restrições físicas e checks adiados.

Não resolva silenciosamente um conflito de safety, hardware, security ou escopo. Registre-o e solicite uma decisão humana.

## Architecture e protocolo

- [`ARCHITECTURE.md`](ARCHITECTURE.md): architecture atual de mobile, protocolo, simulador e firmware.
- [`architecture/repository-layout.md`](architecture/repository-layout.md): boundaries duráveis do repositório e orientações de organização.
- [`protocol/api-v1-outline.md`](protocol/api-v1-outline.md): justificativas e exemplos da API para leitura humana; o OpenAPI continua autoritativo.
- [`protocol/api-v2-outline.md`](protocol/api-v2-outline.md): profiles e extração reconhecida pelo firmware; v1 permanece compatível.
- [`decisions/firmware-foundation.md`](decisions/firmware-foundation.md): decisões aprovadas de firmware, toolchain e foundation.

## Produto e entrega

- [`prds/PRD-001/PRD-001.md`](prds/PRD-001/PRD-001.md): requisitos aprovados para monitoramento local e controle de temperatura.
- [`prds/PRD-001/tasks`](prds/PRD-001/tasks): definições supervisionadas das tasks e acceptance criteria.
- [`TRACKER.md`](TRACKER.md): estado atual de execução e evidências.

A PRD e os arquivos de task são registros históricos/de aprovação. Se a implementação estiver à frente do tracker, não marque a aceitação como concluída sem o reviewer necessário.

## Hardware e segurança

- [`SAFETY.md`](SAFETY.md): status público de segurança e regras de contribuição.
- [`hardware/esp32-c3-wiring.md`](hardware/esp32-c3-wiring.md): GPIOs, ligações dos módulos e checks elétricos não resolvidos.
- [`hardware/temperature-control-tuning.md`](hardware/temperature-control-tuning.md): duty curve implementada e considerações de tuning.
- [`side-notes.md`](side-notes.md): checks adiados de iPhone físico, hardware, relay, cutoff e rede elétrica.
- [`references/README.md`](references/README.md): referências de versões exatas para framework, firmware, componentes e safety.

Nenhum documento do repositório representa aprovação elétrica, térmica, regulatória ou para operação sem supervisão.

## Mantendo a documentação atualizada

Atualize os documentos públicos na mesma mudança sempre que houver alterações em:

- pré-requisitos de setup, comandos, plataformas ou layout dos packages;
- paths, schemas, autenticação, limites ou error mapping da API;
- comportamento de discovery, pairing, persistência, polling ou mutations;
- state transitions do firmware, intervalos de target, timeouts, comportamento de fault ou configuração do hardware;
- status de segurança, findings conhecidos da revisão ou checks físicos adiados.

Use o tempo presente somente para comportamento observável no source atual. Identifique explicitamente comportamento proposed, pending, diagnostic, simulated e human-approved.
