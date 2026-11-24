# Seven Mail — núcleo SQLCipher (fase isolada)

Este crate é uma fundação de armazenamento e ainda não é chamado pelo aplicativo desktop.
Nenhum arquivo do cache atual é movido ou apagado por esta etapa.

## Garantias implementadas no núcleo

- SQLCipher obrigatório, com chave de 256 bits fornecida pelo chamador.
- Verificação da chave antes de modificar o esquema; versão e identificador do banco.
- FTS5 transacional, pesquisa restrita por conta, paginação por cursor.
- Importação idempotente sem sobrescrever registros divergentes, com rollback integral.
- Testes de abertura com chave errada, dados não visíveis no arquivo bruto, FTS, paginação e rollback.

## Critérios de integração obrigatórios

1. Versionar o Cargo.lock do crate após resolução no CI e revisar licenças/dependências.
2. Criar uma chave dedicada no Keyring, com proteção contra criação concorrente, sem reutilizar a chave AES-GCM existente.
3. Integrar após os PRs de integridade e PIN: o acesso ao banco deve exigir autorização nativa.
4. Implementar adaptador de leitura estrita dos arquivos de mensagens legados e mapear todos os campos, incluindo UIDVALIDITY. Nunca pular registros corrompidos silenciosamente.
5. Gerar snapshot consistente em modo manutenção, preservar arquivos originais e validar contagens, identidades e conteúdo; manter o arquivo SQLCipher fora das árvores submetidas à migração AES-GCM.
6. Testar recuperação de interrupção, falta de espaço, arquivos corrompidos, perda de chave e atualização de versão.
7. Implementar cutover e rollback explícitos, sem misturar duas fontes de verdade. Inicialmente não migrar fila SMTP, fontes EML ou credenciais.
8. Integrar limpeza, exclusão de contas, retenção, exportação, pesquisa, paginação e isolamento por identidade; impedir exposição de dados em logs e temporários.
9. Medir desempenho e validar instaladores em Windows, Linux e macOS antes de habilitar a migração.

A pesquisa usa tokens completos e não reproduz ainda a semântica de substring do índice anterior.
O limite de registros retornados é 200. A importação exige uma fonte estável e validada.
Esta etapa não oferece migração automática nem altera o formato persistido em produção.

Referências: https://www.zetetic.net/sqlcipher/sqlcipher-api/ ,
https://sqlite.org/fts5.html e https://docs.rs/crate/rusqlite/0.43.0 .
