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

**Exportar PST** cria um novo arquivo Unicode a partir das mensagens existentes no cache local, sem alterar a origem. O destino deve ter um nome ainda inexistente e estar em um sistema de arquivos que suporte hard links (por exemplo, NTFS). A publicação não sobrescreve um PST existente.

O exportador organiza pastas não vazias pela hierarquia local, separa contas por identificador quando há mais de uma e preserva destinatários Para, CC e CCO disponíveis no cache ou na fonte original. O importador lê a tabela de destinatários e os indicadores MAPI de leitura, sinalização ativa e importância. CCO não recebido no cabeçalho original não pode ser reconstruído.

### Limites e próximos critérios de homologação

A biblioteca `outlook-pst-rw` 1.2.9 escreve mensagens, destinatários e hierarquia, mas sua interface de escrita não oferece propriedades MAPI arbitrárias, propriedades nomeadas ou classes de itens de calendário, contatos e tarefas.

- [ ] Escrita de categorias nativas (`PidNameKeywords`, PS_PUBLIC_STRINGS). Leitura e registro de nomes implementados nesta branch, pendentes de fixture Outlook; cores originais não são recuperadas.
- [ ] Escrita de sinalizadores, leitura, conclusão de acompanhamento e datas de acompanhamento.
- [ ] Exportação de calendários (`IPM.Appointment`), recorrência e fuso original. Importação básica de eventos únicos, horários UTC, local, participantes e categorias implementada, pendente de validação.
- [ ] Exportação de contatos (`IPM.Contact`). Importação básica de nome, e-mails, telefones, empresa, cargo, notas e categorias implementada, pendente de validação.
- [ ] Exportação de tarefas (`IPM.Task`) e recorrência/status avançados. Importação básica de título, datas disponíveis, prioridade, notas e categorias implementada, pendente de validação.
- [ ] Anexos e pastas vazias, bem como pastas especiais e metadados de contas.
- [ ] Preservação de CC/CCO nas futuras revisões de sincronização em nuvem, com isolamento de privacidade.
- [ ] Testes de ida e volta com PST produzido e aberto no Outlook clássico real.

Não considere a migração PST integral até esses critérios serem implementados e homologados. Calendários e contatos ainda podem ser migrados separadamente por ICS e CSV/vCard.

Referências: [API do gravador PST 1.2.9](https://docs.rs/outlook-pst-rw/1.2.9/outlook_pst/struct.UnicodePstFile.html) e [propriedades nomeadas do Outlook](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/about-named-properties-used-by-outlook).

## Dados locais de versões anteriores

O Seven Mail executa migração automática do armazenamento local para criptografia em repouso quando necessário. O processo cria marcador de versão e evita recriptografar arquivos já migrados.

## Backup Seven Mail

Um backup JSON pode restaurar workspace, preferências, regras, perfis e metadados de contas. O modo criptografado protege o arquivo de backup com senha. O backup criptografado protege esse conteúdo com senha definida pelo usuário.

Para um computador novo:

1. instale a mesma versão ou uma versão mais recente;
2. restaure o backup;
3. reconfigure as credenciais no Keyring;
4. autorize OAuth novamente, se usado;
5. sincronize as contas;
6. valide calendários e contatos antes de remover dados do cliente antigo.

## Recomendações

Sempre mantenha uma cópia intacta dos arquivos EML/MSG/OFT/PST originais durante migração e confirme o resultado antes de apagar o cliente anterior.


## Checklist de migração completa

Para uma migração entre computadores ou a partir de outro cliente:

1. mantenha os arquivos originais intactos;
2. importe mensagens por EML/MSG/MBOX/PST conforme a origem;
3. importe modelos OFT quando existirem;
4. importe contatos por CSV/vCard ou sincronize CardDAV/LDAP;
5. importe calendários por ICS ou sincronize CalDAV;
6. restaure o backup Seven Mail para regras, perfis, preferências e workspace;
7. reautorize OAuth e/ou informe novamente credenciais protegidas;
8. valide caixas, calendários, contatos e filas antes de remover a origem.

Credenciais não são copiadas de forma insegura entre dispositivos.

### Importação de itens MAPI

O leitor resolve propriedades nomeadas pelo GUID e LID/nome do mapa do próprio PST, sem assumir que IDs `0x8000+` sejam iguais entre arquivos. Itens de calendário, contatos e tarefas são encaminhados ao workspace, não tratados como e-mails. A importação de recorrências e classes desconhecidas ainda retorna erro explícito; itens importados anteriormente podem permanecer no cache, portanto a importação ainda não é transacional. O exportador continua restrito a mensagens, não sendo um backup completo de workspace.
