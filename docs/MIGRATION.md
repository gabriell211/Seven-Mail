# Migração para o Seven Mail

## Formatos suportados

### Mensagens
- EML: importar e salvar fonte original.
- MSG: importação.
- OFT: leitura como modelo.
- PST: tratado separadamente quando o parser disponível suportar o conteúdo necessário; nunca modifique o PST original durante importação.

### Calendários
- ICS: importar e exportar.

### Contatos
- CSV: importar e exportar.
- vCard/VCF: importar e exportar.
- CardDAV: sincronização quando configurado.

## Migração de contas

Configurações de servidor podem ser recriadas por descoberta automática ou manualmente. Senhas não são importadas de arquivos de backup por segurança; informe a senha/app password ou conecte OAuth novamente.

## Dados locais de versões anteriores

O Seven Mail executa migração automática do armazenamento local para criptografia em repouso quando necessário. O processo cria marcador de versão e evita recriptografar arquivos já migrados.

## Backup Seven Mail

Um backup JSON restaura workspace, preferências e metadados de contas. Para um computador novo:

1. instale a mesma versão ou uma versão mais recente;
2. restaure o backup;
3. reconfigure as credenciais no Keyring;
4. sincronize as contas;
5. valide calendários/contatos antes de remover dados do cliente antigo.

## Recomendações

Sempre mantenha uma cópia intacta dos arquivos EML/MSG/OFT/PST originais durante migração.
