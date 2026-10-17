# FollowCheck 2.6

App iOS (SwiftUI, iOS 17+) que mostra quem te segue de volta e acompanha as mudanças nas contas da tua Watchlist. A sessão do Instagram corre num WKWebView persistente dentro da app. O motor JavaScript (`FollowCheckIOS/Extension`) lê as listas e guarda os resultados apenas neste iPhone.

## Ecrãs

| Separador | O que faz |
|---|---|
| **Início** | Mostra o teu círculo como um diagrama de Venn vivo: quem te segue, quem segues e os mútuos (o mesmo desenho do ícone). Inclui o cartão do check (pronto, em curso ou em pausa de proteção) e as mudanças desde o último check. |
| **Pessoas** | Uma única lista vista por uma lente: Não te seguem, Não segues, Mútuos ou Todos. Podes selecionar perfis, rever tudo num último passo e lançar uma fila de ações com pausas. A fila para na primeira ação que não for confirmada. Os perfis protegidos nunca entram na fila. A Análise de ligações (histórico importado) está no menu deste separador. |
| **Watchlist** | Cada lista (seguidores ou a seguir) aparece como *verificada* ou *parcial*. Quando o Instagram devolve uma lista baralhada e incompleta, a app explica o que aconteceu e não compara essa lista; a outra lista continua a ser comparada. |
| **Atividade** | Três fluxos: a tua conta, a Watchlist e as ações que fizeste. |
| **Mensagens** | Abertas pelo avião de papel no Início ou em Conta. Lista de conversas e chat em ecrãs nativos. Uma página escondida da tua própria sessão do Instagram (`/direct/`) desenha as conversas, e `direct-reader.js` lê o que ela mostra. Não há chamadas extra à API e nada fica guardado. Experimental: se o Instagram mudar a página, a app diz que não conseguiu ler e oferece abrir as mensagens no Instagram. |
| **Conta** | Sessão, mensagens no Instagram, ritmo (Equilibrado, Cuidadoso ou Lento, com valores avançados), duração da pausa após um aviso do Instagram (podes terminá-la), limites das filas (ou sem limites), cópias de segurança, diagnóstico e aparência. |

O que foi removido na 2.6:

- o catálogo de "ferramentas";
- a integração profissional (Zernio);
- a publicação e o calendário;
- o radar de hashtags;
- as coleções e as rotinas;
- a Inbox antiga baseada na API, porque a rota web `direct_v2` devolve 404. Foi substituída pelas Mensagens nativas acima.

Os dados guardados não foram apagados. Se existir uma chave antiga da integração, só é apagada quando o utilizador o pede em **Conta**.

## Motor 2.6 (sobre o 2.5.11)

- **Listas baralhadas:** são detetadas pela repetição de perfis entre páginas (`watchlistOrderingUnstable`). O check termina sem uma segunda passagem, que era o que disparava o bloqueio "spam".
- **Validação por lista:** cada lista tem a sua própria prova (`comparisonVersion: 5`). Uma lista parcial mantém a última referência completa, e a lista válida continua a ser comparada.
- **Build 34, a partir do diagnóstico do dispositivo:**
  - uma lista terminal limpa que difere do contador em max(2, 1%) é aceite numa só leitura, sem a releitura que gastava 14 pedidos;
  - uma lista que começa a repetir perfis (pelo menos max(8, 5%) das linhas após 4 páginas) é parada logo e marcada como parcial;
  - se o Instagram parar a segunda lista, a primeira, já verificada, é guardada e comparada.
- **Pausa mínima (substituída na build 34):** após `rate_limited`, `soft_throttle` ou `http_429`, a pausa é de pelo menos 60 minutos, exceto quando o servidor indica um prazo. Terminar a espera mais cedo não encurta este mínimo.
- **Pausa e limites (build 34):** a pausa após um aviso segue a tua escolha (1 min a 24 h, 1 h por omissão) e pode ser terminada. Só um prazo enviado pelo próprio Instagram não pode ser encurtado. As filas de ações podem correr sem limite de perfis nem de ações por dia.
- **Seguidores de outras contas (build 37):** são lidos como uma pessoa os lê. A janela "Seguidores" do perfil abre numa página escondida da sessão e faz scroll ao ritmo configurado; o motor só observa o que o próprio Instagram carrega (`profile-reader.js`, modo lista, recuperado da 2.5.9). Uma lista lida até ao fim é comparada quando fica até 3% abaixo do contador, porque o contador também inclui contas desativadas e restritas que a lista nunca mostra. Uma lista muito incompleta fica parcial. Uma recusa do Instagram dá uma espera de 1 h, 3 h, 12 h e depois diária, sempre com "Tentar já". A lista "a seguir" continua pela paginação direta, que funciona.
- **Ritmo:** os valores de referência por omissão da 2.5.x que nunca foram alterados passam para o preset Equilibrado (migração `v26`).

## Validação

```sh
scripts/validate-package.sh                       # sintaxe e testes do motor (Node 22)
python3 tests/native-2.5.9/native-relations.py   # testes Swift nativos (requer swift)
NODE_PATH=$(npm root -g) node tests/direct/direct-reader.browser.mjs   # leitor de mensagens em Chromium (Playwright)
```

A CI (`.github/workflows/ios.yml`, em `macos-26`) faz o seguinte:

1. compila em Debug;
2. capta os ecrãs de pré-visualização (`scripts/screens.txt`, em modo claro e escuro, pt-PT);
3. gera o IPA sem assinatura (`scripts/build-unsigned-ipa.sh`);
4. publica tudo no ramo `ci-output`.

As capturas usam dados fictícios, ativados pelos argumentos `--preview-*`, que só existem em builds DEBUG. Não substituem um teste com uma sessão real do Instagram.

## Limites conhecidos

- O Instagram pode limitar a conta seja qual for o ritmo. A app abranda e para quando recebe um aviso, mas não contorna os limites.
- Os checks só correm com a app aberta. O iOS pode dar alguns minutos em segundo plano, sem garantias.
- Uma ação "sem confirmação" pode ter sido aplicada pelo Instagram. Confirma no perfil antes de a repetir.
