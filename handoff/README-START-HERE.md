# FollowCheck — entrega para redesign nativo

O projeto editável está em `native-source-2.5.9/FollowCheckIOS.xcodeproj`. Inclui os ficheiros Swift/SwiftUI, o scheme partilhado, Info.plist, ícone, recursos JavaScript, scripts e testes disponíveis. Declara versão 2.5.9, build 29, e bundle ID `ch.dannysantos.followcheck.ios`.

## Conteúdo

- `native-source-2.5.9/`: projeto nativo recuperado de uma cópia de trabalho existente, conservado sem alterações.
- `engine-source-2.5.11.zip`: motor entregue nesta conversa, com testes e correções de paginação e contagem. Extrair antes de analisar.
- `binaries/FollowCheck-iOS-v2.5.7-unsigned.ipa`: base exata exigida pelo repack.py do motor.
- `binaries/FollowCheck-iOS-v2.5.11-unsigned.ipa`: último IPA entregue nesta conversa, com executável nativo da base 2.5.7 e recursos JavaScript atualizados.
- `provenance/build-source-record.txt`: registo de origem encontrado junto ao projeto. Não certifica a revisão dos ficheiros de trabalho posteriores.
- `SHA256SUMS`: hashes dos ficheiros da entrega.

## Duas linhas de desenvolvimento

O projeto nativo recuperado inclui recolha de relações observadas na sessão WebKit e alterações próprias nas versões 2.5.8/2.5.9, descritas nos ficheiros REVISAO. O motor 2.5.11 desta conversa evoluiu sobre a base 2.5.7 e utiliza pedidos de listas através do executor da página, com validação adicional de IDs e divergências de contagem.

Comparar as interfaces Swift/JavaScript, eventos, persistência e testes antes de integrar alterações entre estas linhas. Substituir simplesmente a pasta Extension do projeto pode eliminar funcionalidades ou quebrar contratos. A versão 2.5.9 deste projeto nativo não identifica o mesmo código do ZIP engine-source 2.5.9 entregue nesta conversa.

Não foi demonstrado que estes fontes produzam exatamente o executável incluído no IPA 2.5.11. São fontes recuperados, não obtidos por descompilação. O ZIP anterior continha apenas o motor e não permitia redesenhar a interface nativa.

## Redesign e compilação

Usar o projeto nativo como base editável para o redesign e aplicar o prompt de design/produto fornecido pelo utilizador. Verificar compatibilidade dos dados e sessões e preservar o bundle ID ao preparar a atualização.

`native-source-2.5.9/scripts/build-unsigned-ipa.sh` chama xcodebuild com o scheme FollowCheckIOS e gera um IPA sem assinatura. Requer macOS e Xcode. Nenhuma compilação Xcode ou execução em iPhone foi feita ao preparar esta entrega. Os workflows mencionados nas notas históricas não estão incluídos nesta cópia; o script de compilação está incluído.

O repack.py do motor atualiza recursos de um executável existente. O redesign SwiftUI requer compilar o projeto nativo modificado.

O projeto referencia um README.md que não existia na cópia recuperada. É documentação e não participa na compilação. Este documento descreve a entrega e as limitações conhecidas.
