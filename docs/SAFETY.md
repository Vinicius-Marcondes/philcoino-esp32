# Segurança e status do projeto

[English](en/SAFETY.md)

Philcoino é um controller experimental para máquina de espresso que trabalha próximo à rede elétrica. O repositório contém software útil e cobertura por host tests, mas não é um safety controller certificado e não está aprovado para produção ou uso sem supervisão. Em 2026-07-16, o owner aceitou a configuração testada após reportar testes funcionais e checks dos controles de energia com equipamento técnico; essa aceitação não é certificação geral.

## Status atual

- A revisão Human de todas as features implementadas e da configuração física testada foi aceita pelo owner em 2026-07-16. A task Agent PHIL-012 de resiliência/contrato automatizado continua pendente.
- A revisão atual do codebase contém findings BLOCKER e MAJOR não resolvidos sobre timing do firmware, monitoramento dos sensores, comportamento de timeout, certeza da saída física, transporte e identidade/credenciais do dispositivo.
- O firmware usa permanentemente uma leitura de thermocouple na base da boiler para brew e steam. Isso mantém um único ponto de falha de controle e não oferece cross-check independente entre sensores.
- A PRD-017 substitui em runtime a correção fixa Steam-only da PRD-003 por um
  offset global assinado e persistido, aplicado uma vez em Brew e Steam após a
  validação raw. Registro ausente significa não calibrado com `0°C`; storage
  corrompido ou ilegível causa fault e comando do heater off. A UI foi aceita
  pelo owner, mas calibração física, precisão do ponto de ebulição e operação
  energizada continuam pendentes.
- O thermostat retido é identificado pelo owner/listing como nominalmente
  `145°C`, 10 A, 250 V. O listing não comprova tolerância, acoplamento, ligação
  em série ou interrupção do heater instalado. A TCAL-008 permite target Steam
  inclusivo de `135°C`; isso é evidência de software e não valida o thermostat
  nem autoriza operação energizada.
- O software da PRD-004 adiciona bias fixo de `+2°C` somente ao cálculo de duty
  durante Manual/main e um workflow de comando de cooldown do firmware com
  cutoff da pump em 45 segundos e estabilização de cinco segundos. THERM-002,
  THERM-010 e THERM-011 foram aceitas pelo owner em 2026-07-16 após testes de
  todas as features e checks dos controles de energia com equipamento técnico.
  A evidência é owner-reported e limitada à configuração testada.
- A implementação OLED/SSD1306 anteriormente desabilitada foi removida em
  PERF-010. GPIO8 e GPIO9 permanecem sem atribuição; isso não aprova novo
  hardware nem altera a aceitação física histórica.
- A aceitação de 2026-07-16 permanece limitada à configuração então testada.
  A predição da PRD-012 agora é preservada somente como pesquisa histórica/
  offline. Os checks A/B de target, comportamento térmico e SSR para o PI Brew
  ativo da PRD-016 continuam pendentes; o selector default-off e a evidência
  host não ampliam a aceitação física anterior. Findings de arquitetura,
  firmware e security continuam sendo trabalho de engenharia.
- Em 2026-07-14, o owner aceitou a matriz funcional da pump no target após relatar discovery HTTP/mDNS, Manual/profiles, Stop/cutoff, continuidade sem app e boot sem retomada. Isso é evidência funcional reportada pelo owner; não inclui captures elétricos independentes, injeção de falha GPIO, timer-wrap no target nem aprovação energizada.

Consulte [CODEBASE_REVIEW_REPORT.md](../CODEBASE_REVIEW_REPORT.md), [docs/TRACKER.md](TRACKER.md) e [docs/side-notes.md](side-notes.md) para as evidências detalhadas.

## O que o software tenta fazer atualmente

O firmware controla o temperature-control loop e não depende da conectividade do aplicativo. Seu policy code:

- valida o status do MAX6675 e leituras finitas;
- valida a leitura raw, aplica um único offset global persistido em Brew e
  Steam e usa a temperatura effective resultante para decisões e snapshots;
- permite temperatura Steam effective e leitura raw até `135°C`, inclusive,
  antes da correção; qualquer uma estritamente acima do cap causa latch de
  `over_temperature` e comando do heater off;
- aplica target e limites de over-temperature específicos de cada mode;
- exige três segundos contínuos na ready band;
- aplica um heating timeout e um timeout de cinco minutos após steam-ready;
- calcula o duty do heater em janelas de dez segundos;
- aplica o bias fixo de extração somente ao duty em Manual/main, sem alterar
  targets, readiness, deadlines, limits ou profiles;
- faz latch de faults e comanda a saída do SSR para off;
- persiste targets, conjuntos completos de profiles validados e o offset de
  calibração em registros NVS separados;
- executa Manual e profiles em um controller monotônico dedicado, inicializa GPIO10 como `off` e não restaura `running` no boot;
- amostra o HX711 fora do loop crítico e só inicia uma extração por peso após
  calibração, disponibilidade, estabilidade e tara automática; falha de tara
  mantém a pump desligada;
- acorda a task da balança por uma notificação coalescente da borda de
  data-ready; a ISR não faz clock, filtro, log ou publicação, e o timeout de
  750 ms mantém a detecção bounded de uma balança desconectada;
- em falha da balança durante a extração, abandona o corte por peso e usa o
  deadline monotônico original do perfil, preservando o cutoff independente de
  60 segundos e bloqueando novo Start por peso até acknowledgement;
- executa cooldown mutuamente exclusivo em uma task de workflow de 10 ms,
  ordena inhibit/off do heater antes do Start da pump e nunca restaura cooldown
  no boot;
- registra até 600 snapshots observacionais em RAM e os expõe em páginas de no
  máximo 8; esse histórico não alimenta nenhuma decisão de heater, pump,
  readiness, timeout, fault ou mutation;
- calcula diagnósticos bounded de requested duty do PI Brew e da curva legacy
  no intervalo fixo de 500 ms; o build default mantém PI somente em shadow,
  enquanto um build explicitamente habilitado seleciona PI apenas em Brew pela
  mesma janela de comando de dez segundos;
- usa uma safety lease GPTimer de 1500 ms para o comando do heater e um único
  mutex de workflow bounded, mantendo NVS e transmissão HTTP fora
  desse boundary;
- inicializa hardware crítico em ordem fail-off.

Esses itens são intenções de design e comportamentos de software cobertos por testes, não prova de desenergização física ou segurança térmica.

O selector PI existe somente em build time, começa desligado e não enfraquece
validação do sensor, permissão do heater, inhibit de cooldown, latch de faults,
limites de over-temperature, safety lease de 1500 ms, tratamento de falha da
saída ou o requisito de cutoff físico independente. Kp, Ki, alpha do EMA e
limites do integral são candidatos compile-time, não tuning fisicamente aceito.
Valores de histórico descrevem requests/comandos; `deliveredCommandDuty1s` é
fração de comando do firmware, não medição da corrente ou potência do SSR.

A concordância entre control e API demonstra somente consistência de software.
Ela não comprova que um offset observado pelo usuário representa temperatura
física calibrada ou o ponto de ebulição local, que `+2°C` melhora a extração,
ou que um comando de cooldown produz fluxo ou resfriamento. Também não
substitui medição independente, cutoff térmico ou revisão energizada.

Da mesma forma, valores históricos de `heaterActive` e `pumpActive` descrevem
o último comando conhecido do firmware. Backfill, SQLite, gráfico e CSV não
provam operação física, fluxo, cooling ou desenergização, e nunca devem ser
usados como feedback para o control loop.

## Limitações conhecidas de alto risco

A revisão atual identifica, entre outros pontos:

- a lease GPTimer e o mutex bounded reduzem exposição do timing do comando de
  software, mas o build/runtime matrix no target fixado, recovery por watchdog,
  continuam sem evidência de source review; o owner aceitou a resposta física
  GPIO/SSR/cutoff da configuração testada sem adicionar os traces brutos;
- o mode diagnóstico com um sensor remove monitoramento independente entre dois sensores, e a detecção de disagreement não está implementada;
- alguns writes remotos válidos ou no-op podem reiniciar deadlines de aquecimento, permitindo que um cliente prolongue a proteção de timeout;
- uma falha ao escrever off no GPIO ainda pode ser apresentada como heater desligado, mesmo quando o estado físico é desconhecido;
- a pump não possui feedback de corrente, SSR, fluxo ou posição do switch; `running` e `off` indicam somente o comando GPIO10 e uma falha de write pode deixar o estado físico desconhecido;
- uma falha ao iniciar mDNS atualmente encerra o HTTP server, invalidando o fallback por endereço manual;
- o pairing verifica um stable ID público, não uma identidade criptográfica do dispositivo;
- credenciais bearer em HTTP plaintext não têm requisitos mínimos de força, throttling, rotação ou confidencialidade no transporte;
- o simulador omite comportamentos críticos de timing, sensores, scheduler, persistence stall e falhas de GPIO do firmware.
- resolução de 0,1 g, simulador, testes host e calibração com uma balança de
  referência não comprovam precisão, repetibilidade, cup presence, montagem ou
  comportamento elétrico do HX711/load cell no target;

Não suavize nem esconda esses findings na documentação destinada ao público. Resolva e verifique cada ponto antes de considerar produção, uso sem supervisão ou outra configuração de hardware.

## Boundary de segurança física

Software não substitui:

- thermal fuse/thermostat independente, corretamente dimensionado e ligado em série com o heater;
- fuse/breaker, condutores, terminais, isolação, creepage, clearance, enclosure, strain relief e protective earth corretamente selecionados;
- autenticidade do SSR, margem de entrada, load rating, failure mode, heat sink, montagem e temperature derating verificados;
- proteções contra pressão e dry boil já exigidas pelo appliance;
- revisão qualificada e medição supervisionada na unidade real.

Um SSR pode falhar em curto. Uma response bem-sucedida da API ou um comando GPIO low não comprova que a corrente da rede elétrica do heater ou da pump foi interrompida.

## Escopo permitido para desenvolvimento

Sem autorização humana explícita, limite o trabalho a:

- static analysis e documentação;
- desenvolvimento de protocolo, simulador, mobile e host tests;
- compilação do firmware e host tests sem energização;
- checks supervisionados de baixa tensão no ESP32/periféricos com o heater/load desconectado.

Não conecte, desconecte, modifique ou energize a fiação da rede elétrica com base apenas nas instruções do repositório.

## Modelo de segurança da informação

As APIs v1 e v2 usam HTTP plaintext local e o mesmo bearer token. A identidade pública é anunciada por mDNS. Isso pode ser aceitável para desenvolvimento restrito em uma LAN confiável e isolada, mas não protege contra um peer local hostil capaz de observar o tráfego, clonar a identidade, roubar/reutilizar um token ou executar brute force contra um token fraco. API v2 amplia o impacto de uma credencial roubada para comandos de extração.

Enquanto os findings conhecidos não forem resolvidos:

- use uma rede dedicada e isolada para desenvolvimento;
- use um token único com alta entropia e nunca faça commit ou log dele;
- não reutilize credenciais pessoais/de contas;
- não exponha a porta do dispositivo à internet;
- trate mudanças de endereço ou identidade como não confiáveis;
- rotacione/remova credenciais após demos ou testes em redes compartilhadas.

## Níveis de evidência

### Boundary de telemetria da extração

Traços de peso/temperatura, marcadores do gráfico e o fluxo derivado em `g/s`
são observações diagnósticas. Eles não comprovam fluxo físico de entrada,
calibração da balança, operação da bomba, massa da bebida, desenergização ou
segurança elétrica. A telemetria nunca pode bloquear, atrasar, retomar ou
alterar decisões de temperatura, aquecedor, bomba, extração, timeout ou falha.
Amostras ausentes permanecem lacunas explícitas.

| Evidência | O que sustenta | O que não sustenta |
| --- | --- | --- |
| Testes Protocol/Zod | Consistência do wire shape | Timing do firmware ou comportamento do hardware |
| Testes do simulador | Fluxos mobile/API no modelo determinístico | Control loop real, sensores, GPIO, SSR ou segurança térmica |
| Host tests do firmware | Policies C++ puras e serialization | Scheduling/I/O do ESP-IDF ou saída física |
| Target build ESP-IDF | Integração de compilação/link para o target | Wiring correto ou segurança em runtime |
| Check de bancada em baixa tensão | Comportamento específico observado de periférico/GPIO | Operação do heater ligado à rede elétrica |
| Teste físico instrumentado e supervisionado | Cenário medido em um build específico | Certificação ou segurança para uso sem supervisão |

Sempre informe qual nível produziu uma afirmação.

## Requisitos antes de produção, uso sem supervisão ou outra configuração energizada

No mínimo:

1. fechar todos os findings BLOCKER e MAJOR relevantes com testes adversariais;
2. validar montagem, atraso, erro e comportamento de falha do sensor único contra um instrumento independente, mantendo um cutoff térmico de hardware independente;
3. verificar safety lease e timing bounded no target fixado, adicionar evidência
   de watchdog/stalls e manter o cutoff físico independente;
4. representar e escalar estado físico desconhecido da saída;
5. impedir que tráfego do cliente prolongue safety deadlines;
6. resolver identidade do dispositivo, força do token, throttling, transporte e segurança de recovery;
7. concluir o build ESP-IDF fixado e os checks em runtime no target;
8. verificar cutoff independente, drive/corrente/comportamento térmico do SSR, wiring, enclosure e proteções com supervisão qualificada;
9. registrar aceitação humana explícita para cada configuração exata do hardware; a configuração testada em 2026-07-16 possui aceitação owner-reported.

Concluir esta lista ainda não representa certificação regulatória.

## Relatando problemas de segurança

Não inclua tokens ativos, credenciais Wi-Fi, endereços privados ou detalhes de exploit relacionados a um dispositivo exposto em uma issue pública. Preserve evidências reproduzíveis, code paths afetados, sequência da falha e comportamento fail-safe esperado; depois coordene de forma privada com o owner do repositório antes da divulgação pública.
