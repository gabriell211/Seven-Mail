# Migração para o Seven Mail

## Formatos suportados

### Mensagens

- **EML:** importação, exportação e preservação da fonte original.
- **MSG:** importação de mensagem, corpo e metadados disponíveis.
- **OFT:** leitura como modelo reutilizável no compositor.
- **PST:** importação recursiva das pastas/mensagens para o cache local e exportação das mensagens locais para um novo PST.
- **MBOX:** quando presente no fluxo de migração, mantenha a origem intacta e importe para uma conta de destino configurada.

O Seven Mail nunca precisa alterar o arquivo PST/MSG/OFT original durante a importação.

### Calendários

- ICS: importar e exportar.
- CalDAV: sincronização bidirecional quando configurado.

### Contatos

- CSV: importar e exportar.
- vCard/VCF: importar e exportar.
- CardDAV: sincronização quando configurado.
- LDAP: diretório corporativo quando configurado.

## Migração de contas

Configurações de servidor podem ser recriadas por descoberta automática ou manualmente. Senhas não são importadas de arquivos de backup por segurança; informe a senha/app password ou conecte OAuth novamente.

Para OAuth, faça nova autorização no dispositivo de destino para que o token seja armazenado no Keyring local.

## Importação PST

Em **Configurações > Dados locais > Importar PST**:

1. escolha a conta local que receberá os dados;
2. selecione o PST;
3. o Seven Mail abre a árvore de pastas;
4. percorre as subpastas recursivamente;
5. importa assunto, corpo, remetente, data e demais metadados disponíveis;
6. preserva o caminho da pasta como organização local;
7. marca as mensagens como importadas/PST.

Campos que não existirem no arquivo recebem fallback seguro; uma propriedade ausente não deve invalidar o restante da migração.

## Exportação PST

**Exportar PST** cria um novo arquivo a partir das mensagens existentes no cache local, sem alterar a origem.

## Dados locais de versões anteriores

O Seven Mail executa migração automática do armazenamento local para criptografia em repouso quando necessário. O processo cria marcador de versão e evita recriptografar arquivos já migrados.

## Backup Seven Mail

Um backup JSON restaura workspace, preferências e metadados de contas. O backup criptografado protege esse conteúdo com senha definida pelo usuário.

Para um computador novo:

1. instale a mesma versão ou uma versão mais recente;
2. restaure o backup;
3. reconfigure as credenciais no Keyring;
4. autorize OAuth novamente, se usado;
5. sincronize as contas;
6. valide calendários e contatos antes de remover dados do cliente antigo.

## Recomendações

Sempre mantenha uma cópia intacta dos arquivos EML/MSG/OFT/PST originais durante migração e confirme o resultado antes de apagar o cliente anterior.
