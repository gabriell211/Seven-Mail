# Seven Mail — núcleo SQLCipher (fase isolada)

Este crate é uma fundação de armazenamento e ainda não é chamado pelo aplicativo desktop.
Nenhum arquivo do cache atual é movido ou apagado por esta etapa.

## Garantias implementadas no núcleo

- SQLCipher obrigatório, com chave de 256 bits fornecida pelo chamador.
- Verificação da chave antes de modificar o esquema; versão e identificador do banco.
- FTS5 transacional, pesquisa restrita por conta, paginação por cursor.
- Importação idempotente sem sobrescrever registros divergentes, com rollback integral.
- Testes de abertura com chave errada, dados não visíveis no arquivo bruto, FTS, paginação e rollback.
- Adaptador de snapshot legado: layout `cache/messages/<conta>/<mensagem>.json`, envelope AES-GCM autenticado por callback, validação de identidade e campos obrigatórios, preservação do JSON completo, fingerprint SHA-256 dos arquivos e conferência exata de contagem em transação.
- Testes com fixtures AES-GCM, adulteração, identidade divergente, snapshot alterado, links simbólicos e destino com registros extras.

## Critérios de integração obrigatórios

1. Cargo.lock canônico gerado pelo CI e versionado. Revisar licenças/dependências e validar novamente os builds bloqueados.
2. Criar uma chave dedicada no Keyring, com proteção contra criação concorrente, sem reutilizar a chave AES-GCM existente.
3. Integrar após os PRs de integridade e PIN: o acesso ao banco deve exigir autorização nativa.
4. Integrar o adaptador de snapshot ao backend nativo, fornecendo o decryptor AES-GCM autenticado, sem permitir criação de chave legada quando houver dados preexistentes. O JSON é preservado integralmente; o adaptador não reconstrói o estado UIDVALIDITY armazenado fora das mensagens.
5. Integrar `create_snapshot` ao modo manutenção, com exclusão de todos os escritores e destino fora do cache. A cópia de metadados criptografados é exclusiva, verifica contagem e SHA-256 e publica manifesto após concluir; `migrate_completed_snapshot` valida o manifesto dentro da transação. Manter o arquivo SQLCipher fora das árvores submetidas à migração AES-GCM.
6. Testar recuperação de interrupção, falta de espaço, arquivos corrompidos, perda de chave e atualização de versão.
7. Implementar cutover e rollback explícitos, sem misturar duas fontes de verdade. Inicialmente não migrar fila SMTP, fontes EML ou credenciais.
8. Integrar limpeza, exclusão de contas, retenção, exportação, pesquisa, paginação e isolamento por identidade; impedir exposição de dados em logs e temporários.
9. Medir desempenho e validar instaladores em Windows, Linux e macOS antes de habilitar a migração.

A pesquisa usa tokens completos e não reproduz ainda a semântica de substring do índice anterior.
O limite de registros retornados é 200. A importação exige uma fonte estável e validada, criada em modo manutenção e protegida contra alterações externas. A checagem de fingerprint detecta deriva acidental, não substitui isolamento do snapshot. Arquivos EML, estado IMAP, anexos e fila não são migrados. Arquivos maiores que o limite ou inesperados interrompem a migração. O destino deve ser um banco de staging separado e não utilizado pelo aplicativo.
Todos os ambientes CI recebem o mesmo lockfile canônico, agora versionado e obrigatório.
O manifesto detecta deriva acidental, não é uma assinatura nem substitui a autenticação AES-GCM. Backups incompletos não são automaticamente excluídos; uma nova tentativa deve usar outro destino. O backup é apenas de metadados de mensagens, não um backup integral do aplicativo. Esta etapa não oferece migração automática nem altera o formato persistido em produção.

Referências: https://www.zetetic.net/sqlcipher/sqlcipher-api/ ,
https://sqlite.org/fts5.html e https://docs.rs/crate/rusqlite/0.43.0 .
