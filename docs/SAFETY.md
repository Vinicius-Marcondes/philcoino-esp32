# Segurança e status do projeto

[English](en/SAFETY.md)

Philcoino é um controller experimental para máquina de espresso que trabalha próximo à rede elétrica. O repositório contém software útil e cobertura por host tests, mas não é um safety controller certificado e não está aprovado para produção, uso sem supervisão ou operação do heater ligado à rede elétrica.

## Status atual

- As tasks de software da PRD-001 avançaram até o monitoramento mobile e controles com acknowledgement, mas o tracker ainda registra tasks posteriores de revisão/validação física como incompletas.
- A revisão atual do codebase contém findings BLOCKER e MAJOR não resolvidos sobre timing do firmware, monitoramento dos sensores, comportamento de timeout, certeza da saída física, transporte e identidade/credenciais do dispositivo.
- O firmware usa permanentemente uma leitura de thermocouple na base da boiler para brew e steam. Isso mantém um único ponto de falha de controle e não oferece cross-check independente entre sensores.
- A PRD-003 implementa uma correção fixa e owner-selected de `+5°C` apenas em
  Steam, depois da validação da leitura raw. O valor corrigido orienta control,
  limits, API e OLED, mas ainda depende do mesmo sensor único e aguarda
  validação física instrumentada e repetível na STEAM-004.
- O software da PRD-004 adiciona bias fixo de `+2°C` somente ao cálculo de duty
  durante Manual/main e um workflow de comando de cooldown do firmware com
  cutoff da pump em 45 segundos e estabilização de cinco segundos. A revisão
  visual/accessibility da THERM-002 e toda aceitação target/física das
  THERM-010/THERM-011 continuam pendentes no Human Review Ledger; nenhuma
  evidência de cooling físico ou operação energizada foi produzida.
- O source atual do firmware habilita o OLED (`kOledEnabled = true`), enquanto o tracker registra um estado temporário com OLED desabilitado. Trate isso como uma divergência não resolvida entre documentação e configuração, não como um estado de hardware aprovado.
- Discovery físico no iPhone, comportamento final dos sensores, instalação do relay/SSR, cutoff independente e validação energizada supervisionada continuam sendo checks humanos.
- Em 2026-07-14, o owner aceitou a matriz funcional da pump no target após relatar discovery HTTP/mDNS, Manual/profiles, Stop/cutoff, continuidade sem app e boot sem retomada. Isso é evidência funcional reportada pelo owner; não inclui captures elétricos independentes, injeção de falha GPIO, timer-wrap no target nem aprovação energizada.

Consulte [CODEBASE_REVIEW_REPORT.md](../CODEBASE_REVIEW_REPORT.md), [docs/TRACKER.md](TRACKER.md) e [docs/side-notes.md](side-notes.md) para as evidências detalhadas.

## O que o software tenta fazer atualmente

O firmware controla o temperature-control loop e não depende da conectividade do aplicativo. Seu policy code:

- valida o status do MAX6675 e leituras finitas;
- usa a leitura raw em Brew e aplica uma única correção compile-time de `+5°C`
  em Steam antes das decisões e snapshots;
- aplica target e limites de over-temperature específicos de cada mode;
- exige três segundos contínuos na ready band;
- aplica um heating timeout e um timeout de cinco minutos após steam-ready;
- calcula o duty do heater em janelas de dez segundos;
- aplica o bias fixo de extração somente ao duty em Manual/main, sem alterar
  targets, readiness, deadlines, limits ou profiles;
- faz latch de faults e comanda a saída do SSR para off;
- persiste apenas targets e conjuntos completos de profiles validados;
- executa Manual e profiles em um controller monotônico dedicado, inicializa GPIO10 como `off` e não restaura `running` no boot;
- executa cooldown mutuamente exclusivo em uma task de workflow de 10 ms,
  ordena inhibit/off do heater antes do Start da pump e nunca restaura cooldown
  no boot;
- usa uma safety lease GPTimer de 1500 ms para o comando do heater e um único
  mutex de workflow bounded, mantendo NVS, display e transmissão HTTP fora
  desse boundary;
- inicializa hardware crítico em ordem fail-off.

Esses itens são intenções de design e comportamentos de software cobertos por testes, não prova de desenergização física ou segurança térmica.

A concordância entre control, API e OLED demonstra somente consistência de
software. Ela não comprova que `+5°C` representa a diferença física da boiler,
que `+2°C` melhora a extração ou que um comando de cooldown produz fluxo ou
resfriamento. Também não substitui medição independente, cutoff térmico ou
revisão energizada.

## Limitações conhecidas de alto risco

A revisão atual identifica, entre outros pontos:

- a lease GPTimer e o mutex bounded reduzem exposição do timing do comando de
  software, mas o build/runtime matrix no target fixado, recovery por watchdog,
  resposta física GPIO/SSR e cutoff independente continuam sem verificação;
- o mode diagnóstico com um sensor remove monitoramento independente entre dois sensores, e a detecção de disagreement não está implementada;
- alguns writes remotos válidos ou no-op podem reiniciar deadlines de aquecimento, permitindo que um cliente prolongue a proteção de timeout;
- uma falha ao escrever off no GPIO ainda pode ser apresentada como heater desligado, mesmo quando o estado físico é desconhecido;
- a pump não possui feedback de corrente, SSR, fluxo ou posição do switch; `running` e `off` indicam somente o comando GPIO10 e uma falha de write pode deixar o estado físico desconhecido;
- uma falha ao iniciar mDNS atualmente encerra o HTTP server, invalidando o fallback por endereço manual;
- o pairing verifica um stable ID público, não uma identidade criptográfica do dispositivo;
- credenciais bearer em HTTP plaintext não têm requisitos mínimos de força, throttling, rotação ou confidencialidade no transporte;
- o simulador omite comportamentos críticos de timing, sensores, scheduler, persistence stall e falhas de GPIO do firmware.

Não suavize nem esconda esses findings na documentação destinada ao público. Resolva e verifique cada ponto antes de reconsiderar operação energizada.

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

| Evidência | O que sustenta | O que não sustenta |
| --- | --- | --- |
| Testes Protocol/Zod | Consistência do wire shape | Timing do firmware ou comportamento do hardware |
| Testes do simulador | Fluxos mobile/API no modelo determinístico | Control loop real, sensores, GPIO, SSR ou segurança térmica |
| Host tests do firmware | Policies C++ puras e serialization | Scheduling/I/O do ESP-IDF ou saída física |
| Target build ESP-IDF | Integração de compilação/link para o target | Wiring correto ou segurança em runtime |
| Check de bancada em baixa tensão | Comportamento específico observado de periférico/GPIO | Operação do heater ligado à rede elétrica |
| Teste físico instrumentado e supervisionado | Cenário medido em um build específico | Certificação ou segurança para uso sem supervisão |

Sempre informe qual nível produziu uma afirmação.

## Requisitos antes de considerar operação energizada

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
9. registrar aceitação humana explícita para a configuração exata do hardware.

Concluir esta lista ainda não representa certificação regulatória.

## Relatando problemas de segurança

Não inclua tokens ativos, credenciais Wi-Fi, endereços privados ou detalhes de exploit relacionados a um dispositivo exposto em uma issue pública. Preserve evidências reproduzíveis, code paths afetados, sequência da falha e comportamento fail-safe esperado; depois coordene de forma privada com o owner do repositório antes da divulgação pública.
