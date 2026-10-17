# FollowCheck iOS 2.5.11 — build 31

Corrige a interrupção da Watchlist quando a lista termina com mais identidades do que o contador do perfil, como as 344 contas seguidas contra 343 anunciadas no diagnóstico da build 30. A divergência passa a poder ser guardada como observação consistente das listas visíveis, com aviso explícito e confirmação independente dos mesmos IDs.

## Evidência e comportamento

Na build 30, as 14 páginas de contas seguidas responderam com HTTP 200. Foram recebidas 344 identidades únicas, sem duplicados, e a última página confirmou o fim da lista. Uma nova leitura do perfil continuou a anunciar 343. A validação exigia igualdade numérica e interrompia o check antes de começar os seguidores. Neste check não houve HTTP 400 nem sinal explícito de restrição. O diagnóstico não permite identificar a causa da discrepância no serviço.

Esta revisão distingue dois modos de validação:

| Modo | Evidência exigida | Resultado |
| --- | --- | --- |
| `count-matched` | Paginação terminada e número de identidades únicas igual ao total anunciado. | Mantém a comparação existente. |
| `stable-surplus` | Mais identidades do que o total anunciado; contador novamente confirmado; duas travessias independentes terminadas, sem duplicados e com exatamente o mesmo conjunto de IDs; totais finais do perfil inalterados. | Guarda e compara as listas visíveis, com aviso de contador divergente. |

A ordem das contas pode mudar entre as duas travessias. Apenas o conjunto de IDs é comparado. Ter 344 contas nas duas leituras não basta se forem contas diferentes. As observações nunca são unidas para fabricar uma lista maior. Uma lista com menos identidades do que o perfil anuncia continua a bloquear a comparação, incluindo o caso anterior de 924/1172 seguidores. Uma recusa HTTP, cursor repetido, estrutura inválida, pausa ou restrição não dá origem a uma terceira travessia ou a uma troca de canal.

O contador anunciado e o número de identidades observadas ficam separados. O caso 344/343 mantém `reportedFollowing: 343`, `following: 344` e `coverageVerified: false`; `enumerationVerified: true` identifica o acordo entre as enumerações visíveis. Não é uma afirmação de que todas as relações existentes no Instagram foram expostas à sessão.

As referências guardam a prova por lista no formato de comparação 4. As referências anteriores de formato 3 continuam válidas quando correspondiam aos totais anunciados. Uma referência sem prova suficiente não é usada para gerar diferenças. Nas relações afetadas por divergência, os títulos dos eventos descrevem entradas ou ausências na lista observada. As saídas continuam a exigir ausência em dois checks consecutivos. Uma divergência de contador, por si só, não conta como alteração de relação nem envia uma notificação de mudança.

## Pausas e retoma

O contador usado para as pausas periódicas passa a abranger todas as páginas do check, incluindo a segunda travessia e a troca de listas. Antes, cada travessia de 14 páginas ficava abaixo do intervalo de 15 páginas e reiniciava esse contador. Foi também acrescentada a pausa configurada entre contas seguidas e seguidores. Continuam a ser respeitados os valores de ritmo configurados na app.

Os checkpoints têm formato 4. Uma segunda travessia interrompida guarda os IDs da primeira, o cursor corrente e o total de páginas do check. A retoma exige a mesma conta, perfil, tipo de lista e total, dentro do prazo existente de 15 minutos. Checkpoints antigos sem esta prova são descartados; os snapshots anteriores são preservados.

## Tratamento de pedidos mantido

Mantém-se o formato web utilizado pela base 2.5.7: `count`, `search_surface=follow_list_page` e o cursor opaco em `max_id`. Não se envia o `rank_token` sintético introduzido na 2.5.8. Mantêm-se as correções da 2.5.10: preservação textual de IDs/cursores numéricos grandes, codificação única de caracteres reservados, validação do cursor e classificação de sinais explícitos `spam`/`feedback_required`. Uma mensagem vazia ou o tamanho da resposta não são usados para inferir uma restrição.

## Verificação

```sh
node --test tests/runtime-regression.mjs tests/watchlist-pagination.mjs
```

Passaram 95 testes locais. O cenário integrado atravessa o executor de página, as respostas HTTP simuladas, o coletor, a ponte iOS e o registo da Watchlist: 14 + 14 páginas de contas seguidas e 47 de seguidores, com 344/343 e 1171/1171. Verifica os avisos, os totais separados, a publicação do estado, as notificações e as pausas nas páginas globais 15, 30, 45 e 60. Testa ainda IDs diferentes apesar de contagens iguais, duplicados, referências inválidas, retoma da segunda travessia, mudança dos totais finais, rejeição HTTP e preservação da referência anterior.

Os testes usam respostas simuladas e não fizeram pedidos à conta do utilizador. Não houve teste no iPhone, num simulador Apple ou no serviço Instagram real. A aceitação das próximas páginas pelo serviço continua dependente da sessão real. O evento local `probe-session` com HTTP 0 não prova autenticação pelo servidor.

Foi validada a sintaxe dos 11 JavaScript autónomos. `native-legacy.js` é um fragmento lexical do bundle e mantém os bytes originais. O teste herdado de interrupção aceita `ios_paused` ou `check_preempted`, ambos resultados de rejeição observados no motor base.

## Reproduzir o IPA

```sh
python3 repack.py FollowCheck-iOS-v2.5.7-unsigned.ipa FollowCheck-iOS-v2.5.11-unsigned.ipa
```

O empacotador escreve num ficheiro temporário, valida o ZIP e publica o nome final por renomeação atómica. Apenas `Extension/background.js`, `Extension/page-executor.js` e `Info.plist` diferem da base 2.5.7. Os 22 elementos, CRC, atributos ZIP, plist e bytes do executável são verificados. A versão passa a 2.5.11, build 31. A cópia descarregada depois de guardar é comparada byte a byte e por SHA-256 e verificada com `unzip -t`.

Este pacote contém os recursos do motor, dois ficheiros de testes, os resultados, o patch face à base, os hashes e o empacotador. O executável nativo é o existente da 2.5.7, sem recompilação Swift/Xcode. O IPA não está assinado. Este arquivo de motor não é o código Swift completo da app.

## Instalação

Assinar o IPA e instalar como atualização da app existente, com a mesma identidade de assinatura e identificador da aplicação, para conservar os dados. Fazer um check com a app ativa. No caso 344/343, o resultado esperado é a confirmação dos mesmos IDs na segunda travessia e a continuação para os seguidores; o resultado final deve conservar o aviso de contador divergente. Se uma lista for recusada ou ficar incompleta, a referência anterior mantém-se.
