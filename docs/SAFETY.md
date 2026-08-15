# Segurança e status do projeto

Status: PROTÓTIPO — NÃO APROVADO PARA PRODUÇÃO, USO SEM SUPERVISÃO OU MAINS

A geração atual usa ESP32-S3-WROOM-1 N16R8, dois MAX6675, heater SSR em
GPIO21 e dimmer RobotDyn ZC6/DIM10. Nenhum teste de software prova
desenergização, isolamento, pressão, temperatura física ou segurança elétrica.

## Boundary de software

Firmware continua sendo a autoridade. Startup e faults tentam comandar heater
e pump OFF; isso não confirma que SSR, TRIAC, wiring, heater ou pump ficaram
fisicamente desligados. SSR pode falhar em curto e exige interrupção térmica
independente, proteção/fusível adequado, enclosure, grounding e dimensionamento.

Brew usa somente o sensor Boiler; Steam usa somente Steam. Não há fallback nem
blending. Um sample ativo inválido comanda heater OFF imediatamente e três
falhas consecutivas fazem latch de `sensor_failure`. Um sensor inativo inválido
bloqueia seu mode sem interromper o mode saudável. Qualquer raw >135°C faz
latch imediato com identificação do sensor.

Calibração Boiler/Steam é independente e apenas uma session existe. Durante
calibração, o outro sensor continua validando e protegendo contra raw
over-temperature. Calibração guiada e targets são comandos/transformações de
software; não provam boiling point, accuracy, placement ou thermal lag.

O dimmer inicializa em 0% e comandos running usam cap único de 90%. Esse valor
não é tensão, potência, pressão, flow ou proteção contra sobrepressão. Não há
closed-loop pressure control e o sensor de pressão pendente não participa do
safety loop.

## Migração invalida acceptance anterior

Aceitações anteriores em ESP32-C3, um MAX6675, pump SSR, heater GPIO20 ou
RobotDyn GPIO10 não validam o mapa S3, dois probes simultâneos, GPIO21, native
USB boot/reset, placement Steam near-valve, ou comportamento do novo firmware.
O hardware anterior permanece evidence histórica apenas.

## Trabalho permitido

São permitidos testes de protocolo, simulador, mobile, C++ host/sanitizers,
contract captures e build ESP-IDF target. Com heater e pump loads desconectados,
um humano qualificado pode executar verificação supervisionada em baixa tensão.
Flashing control-capable e qualquer energized acceptance são ações humanas
separadas e não estão autorizadas por este repositório.

Antes de flashing, confirmar:

- o board exato de 44 pins expõe todos os GPIOs selecionados;
- ambos thermocouples são electrically ungrounded;
- nenhum pin reservado conflita com wiring real;
- há mecanismo independente de over-temperature/interrupção.

Com loads desconectados, verificar:

- estabilidade simultânea e isolamento probe-to-boiler/probe-to-probe;
- CS/SCK/SO dos dois canais a cada 500 ms;
- ausência de pulse inseguro em GPIO21/GPIO10 em boot/reset;
- native USB console/recovery;
- ZC isolado, dimmer 0% cessation e timing 90% a 60 Hz;
- HX711/watchdog sem starvation.

Qualquer interferência dual-probe bloqueia Steam control até correção física.

## Evidence

Protocol/simulator/mobile/host/sanitizer/capture/target-build são níveis
separados de evidence. Nenhum substitui instrumentação física ou revisão mains.
Simulator é somente UI/contract. Target build é somente compile/link. Logs não
provam output físico.

## Segurança da informação

API v4 usa SRP pairing, certificate binding, pinned HTTPS, tokens no SecureStore
e strict parsing. A S3/v4 exige rebuilt app e fresh pairing. Não desabilite TLS
ou pinning para resolver handshake. mDNS/TXT, addresses, storage e HTTP continuam
inputs não confiáveis e devem permanecer estritamente validados.

## Antes de qualquer uso energizado futuro

É necessário, no mínimo, hardware definitivo documentado, revisão elétrica
independente, cutoff térmico independente validado, proteção contra pressão,
fusing/grounding/enclosure adequados, instrumentação, testes de falhas/boot,
estabilidade dual-probe, validação do dimmer/SSR, procedimento supervisionado
e fechamento dos findings BLOCKER/MAJOR aplicáveis.

Reporte problemas de segurança sem incluir credentials, pairing secrets,
Wi-Fi passwords, tokens ou certificados privados.
