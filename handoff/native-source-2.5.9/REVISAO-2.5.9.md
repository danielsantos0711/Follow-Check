# 2.5.9 — confirmação do fim das listas e isolamento por perfil

Mantém a recolha das listas carregadas pelo Instagram na sessão WebKit, introduzida na 2.5.8, e corrige duas falhas demonstradas durante a revisão do erro `watch_coverage_incomplete`.

## Correções

- Atingir o contador do perfil não conclui uma lista com mais páginas. Uma lista não vazia exige fim explícito, ausência de pedidos pendentes, IDs únicos suficientes e nenhuma entrada inválida. Um total zero confirmado no perfil continua a permitir uma lista vazia sem um diálogo de paginação inexistente.
- Pedidos GraphQL observados permanecem pendentes até o corpo ter sido analisado, incluindo respostas cuja identificação do perfil só aparece no conteúdo.
- Cada página tem de apresentar a sua própria evidência de continuação/fim. Indicadores contraditórios produzem `list_pagination_conflict` e preservam a referência anterior.
- Uma conexão GraphQL pertence ao perfil que a contém. Um perfil aninhado com outro ID não pode fornecer seguidores para o perfil observado, mesmo que a raiz da resposta corresponda ao alvo.
- O diagnóstico nativo e o erro de cobertura incluem entradas brutas, duplicados, inválidos, fim da lista e pedidos pendentes.

As verificações de ambas as listas e dos contadores antes/depois continuam a anteceder a escrita do snapshot. Não são alterados os limiares de cobertura, o identificador da app, a persistência da sessão ou o funcionamento independente da Watchlist.

## Validação

- Três regressões reproduziram falhas na 2.5.8 antes da correção: fim prematuro, conclusão com pedido pendente e associação de uma conexão de outro perfil. Os mesmos testes passam com a correção.
- 153 testes de execução JavaScript passaram localmente, juntamente com as verificações de bootstrap e dos algoritmos existentes.
- A verificação WebKit no simulador foi reforçada: a primeira página já atinge o total esperado mas declara continuação; a app tem de carregar a segunda página terminal. O workflow exige duas páginas, fim confirmado e zero pedidos pendentes.
- O workflow continua a exigir testes nativos, compilação para simulador e compilação da IPA não assinada antes da publicação do artefacto.

A enumeração efetiva da conta no Instagram requer um check no dispositivo. Se o serviço continuar a disponibilizar uma lista incompleta, a aplicação deve reportar essa incompletude e conservar a referência, sem fabricar alterações.
