# FollowCheck 2.6

App iOS (SwiftUI, iOS 17+) que mostra quem te segue de volta e acompanha as mudanças nas contas da tua Watchlist. A sessão do Instagram corre num WKWebView persistente dentro da app. O motor JavaScript (`FollowCheckIOS/Extension`) lê as listas e guarda os resultados apenas neste iPhone.

## Ecrãs

| Separador | O que faz |
|---|---|
| **Início** | Mostra o teu círculo como um diagrama de Venn vivo: quem te segue, quem segues e os mútuos (o mesmo desenho do ícone). Inclui o cartão do check (pronto, em curso ou em pausa de proteção) e as mudanças desde o último check. |
| **Pessoas** | Uma única lista vista por uma lente: Não te seguem, Não segues, Mútuos ou Todos. Podes selecionar perfis, rever tudo num último passo e lançar uma fila de ações com pausas. A fila para na primeira ação que não for confirmada. Os perfis protegidos nunca entram na fila. A Análise de ligações (histórico importado) está no menu deste separador. |
| **Watchlist** | Cada lista (seguidores ou a seguir) aparece como *verificada* ou *parcial*. Quando o Instagram devolve uma lista baralhada e incompleta, a app explica o que aconteceu e não compara essa lista; a outra lista continua a ser comparada. |
| **Atividade** | Três fluxos: a tua conta, a Watchlist e as ações que fizeste. |
| **Conta** | Sessão, mensagens no Instagram, ritmo (Equilibrado, Cuidadoso ou Lento, com valores avançados), pausa mínima de 1 h após um aviso do Instagram, cópias de segurança, diagnóstico e aparência. |

O que foi removido na 2.6:

- o catálogo de "ferramentas";
- a integração profissional (Zernio);
- a publicação e o calendário;
- o radar de hashtags;
- as coleções e as rotinas;
- a Inbox nativa, porque o endpoint devolve 404 (as mensagens abrem no próprio Instagram).

Os dados guardados não foram apagados. Se existir uma chave antiga da integração, só é apagada quando o utilizador o pede em **Conta**.

## Motor 2.6 (sobre o 2.5.11)

- **Listas baralhadas:** são detetadas pela repetição de perfis entre páginas (`watchlistOrderingUnstable`). O check termina sem uma segunda passagem, que era o que disparava o bloqueio "spam".
- **Validação por lista:** cada lista tem a sua própria prova (`comparisonVersion: 5`). Uma lista parcial mantém a última referência completa, e a lista válida continua a ser comparada.
- **Pausa mínima:** após `rate_limited`, `soft_throttle` ou `http_429`, a pausa é de pelo menos 60 minutos, exceto quando o servidor indica um prazo. Terminar a espera mais cedo não encurta este mínimo.
- **Ritmo:** os valores de referência por omissão da 2.5.x que nunca foram alterados passam para o preset Equilibrado (migração `v26`).

## Validação

```sh
scripts/validate-package.sh                       # sintaxe e testes do motor (Node 22)
python3 tests/native-2.5.9/native-relations.py   # testes Swift nativos (requer swift)
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
