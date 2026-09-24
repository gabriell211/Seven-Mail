# Seven Mail

<p align="center">
  <strong>Cliente de e-mail moderno, completo e multiplataforma.</strong>
</p>

<p align="center">
  Centralize e-mails, calendários, contatos, tarefas e organização pessoal ou profissional em uma única aplicação.
</p>

---

## Sobre o projeto

O **Seven Mail** é um cliente de e-mail completo, criado para oferecer uma experiência rápida, organizada e consistente em diferentes plataformas.

A proposta é reunir em um único aplicativo tudo o que normalmente é necessário no dia a dia:

- E-mail
- Calendário
- Contatos
- Tarefas
- Regras e automações
- Pesquisa avançada
- Múltiplas contas
- Modo offline
- Importação e exportação
- Segurança e privacidade

> **Status:** Em desenvolvimento ativo. A linha desktop 0.3.x já possui cliente local-first funcional para Windows e Linux, com IMAP/SMTP, múltiplas contas, caixa unificada, composição, fila offline, regras, pesquisa avançada, calendário local, contatos, tarefas, notas e sincronização opcional com Neon.

### Estado atual

A implementação atual já inclui:

- Cliente desktop Tauri 2 com React 19 + TypeScript e backend Rust.
- Windows e Linux com instaladores nativos.
- IMAP/SMTP com descoberta automática e configuração manual.
- Múltiplas contas e caixa unificada.
- Cache local, leitura offline, rascunhos e caixa de saída durável.
- Resposta, responder a todos, encaminhamento, anexos, assinaturas por conta, envio agendado e desfazer envio.
- Pastas IMAP personalizadas com criação, renomeação, exclusão e movimentação de mensagens.
- Categorias locais, mensagens fixadas, pesquisas salvas e ordenação configurável.
- Painel de leitura à direita, abaixo ou desativado, com densidade compacta e linhas de prévia configuráveis.
- Pesquisa local avançada com operadores como `from:`, `to:`, `subject:`, `body:`, `folder:`, `is:unread`, `is:flagged`, `has:attachment`, `after:` e `before:`.
- Regras executadas automaticamente após sincronização ou manualmente, com prioridade e opção de interromper o processamento.
- Calendário, contatos, tarefas e notas persistentes em modo local-first.
- Conversão de e-mail em tarefa e retorno da tarefa ao e-mail relacionado.
- Lembretes nativos de tarefas e notificações de novas mensagens.
- Credenciais mantidas no Credential Manager/Keyring do sistema operacional.
- Sincronização cloud opcional via Neon para metadados e workspace; credenciais de e-mail não são enviadas ao Neon.

Recursos como OAuth/PKCE por provedor, CalDAV, CardDAV, POP3, S/MIME, importação PST/MSG/OFT, caixas compartilhadas, delegação e recursos corporativos avançados permanecem no roadmap.

---

## Objetivos

O Seven Mail deve ser capaz de funcionar tanto para uso pessoal quanto profissional, oferecendo:

- Interface moderna e responsiva
- Sincronização rápida
- Suporte a vários provedores
- Múltiplas contas simultâneas
- Operação offline
- Baixo consumo de recursos
- Organização avançada
- Experiência consistente entre plataformas
- Segurança por padrão
- Arquitetura preparada para grande volume de mensagens

---

# Recursos planejados

## E-mail

### Caixa de entrada

- [ ] Caixa de entrada por conta
- [ ] Caixa de entrada unificada
- [ ] Caixa prioritária e Outros
- [ ] Ativar/desativar caixa prioritária
- [ ] Visualização por conversa
- [ ] Visualização individual de mensagens
- [ ] Contagem de mensagens não lidas
- [ ] Atualização automática
- [ ] Sincronização manual
- [ ] Paginação eficiente
- [ ] Carregamento incremental
- [ ] Pré-visualização da mensagem
- [ ] Uma ou duas linhas de pré-visualização configuráveis
- [ ] Ordenação por remetente, assunto, data, tamanho e status
- [ ] Formatação condicional da lista de mensagens
- [ ] Cabeçalhos recolhíveis na lista
- [ ] Ações rápidas configuráveis na lista
- [ ] Painel de leitura configurável
- [ ] Abrir mensagem em nova janela
- [ ] Abrir múltiplas mensagens simultaneamente

### Mensagens

- [ ] Enviar e-mail
- [ ] Responder
- [ ] Responder a todos
- [ ] Encaminhar
- [ ] Encaminhar como anexo
- [ ] Editar rascunhos
- [ ] Salvar rascunhos automaticamente
- [ ] Excluir mensagens
- [ ] Restaurar mensagens excluídas
- [ ] Arquivar
- [ ] Marcar como lida
- [ ] Marcar como não lida
- [ ] Fixar mensagem
- [ ] Sinalizar mensagem
- [ ] Remover sinalização
- [ ] Adiar mensagem
- [ ] Mover para pasta
- [ ] Copiar para pasta
- [ ] Imprimir mensagem
- [ ] Salvar mensagem
- [ ] Exibir cabeçalhos completos
- [ ] Visualizar código-fonte da mensagem
- [ ] Marcar como spam
- [ ] Marcar como phishing
- [ ] Bloquear remetente
- [ ] Liberar remetente
- [ ] Ignorar conversa
- [ ] Silenciar conversa
- [ ] Reenviar mensagem
- [ ] Recuperar/recolher mensagem enviada quando suportado pelo provedor
- [ ] Reações em mensagens quando suportadas
- [ ] Arrastar mensagens entre pastas
- [ ] Arrastar mensagens entre contas quando suportado
- [ ] Criar evento a partir de um e-mail
- [ ] Criar tarefa a partir de um e-mail

### Composição

- [ ] Editor de texto rico
- [ ] Texto simples
- [ ] HTML
- [ ] Negrito
- [ ] Itálico
- [ ] Sublinhado
- [ ] Tachado
- [ ] Listas
- [ ] Recuo
- [ ] Alinhamento
- [ ] Links
- [ ] Tabelas
- [ ] Imagens inline
- [ ] Emojis
- [ ] Campo De selecionável
- [ ] Envio usando aliases
- [ ] Corretor ortográfico
- [ ] Correção automática
- [ ] Capitalização automática
- [ ] Dicionários por idioma
- [ ] Ditado por voz quando disponível no sistema
- [ ] Assinaturas
- [ ] Assinatura diferente por conta
- [ ] Assinatura para novas mensagens
- [ ] Assinatura para respostas
- [ ] CC
- [ ] CCO
- [ ] Prioridade
- [ ] Confirmação de leitura quando suportada
- [ ] Confirmação de entrega quando suportada
- [ ] Programar envio
- [ ] Atraso padrão antes do envio
- [ ] Desfazer envio
- [ ] Modelos de mensagem
- [ ] Modelos baseados em arquivo quando suportado
- [ ] Reutilização de blocos de conteúdo
- [ ] Pré-visualização de links
- [ ] Verificação de destinatários
- [ ] Aviso de anexo esquecido
- [ ] Aviso de assunto vazio

### Anexos

- [ ] Upload por botão
- [ ] Arrastar e soltar
- [ ] Download
- [ ] Download de todos
- [ ] Pré-visualização
- [ ] Imagens
- [ ] PDFs
- [ ] Documentos
- [ ] Planilhas
- [ ] Arquivos compactados
- [ ] Limite configurável
- [ ] Indicador de progresso
- [ ] Cancelamento de upload
- [ ] Bloqueio de extensões perigosas
- [ ] Arrastar anexos para a área de trabalho
- [ ] Arrastar anexos para outros aplicativos
- [ ] Mover anexos entre mensagens e contas quando permitido

### Produtividade de e-mail

- [ ] Ações rápidas compostas por múltiplas etapas
- [ ] Atalhos para ações rápidas
- [ ] Limpeza automática por remetente
- [ ] Ignorar e limpar conversas
- [ ] Respostas automáticas / ausência temporária
- [ ] Encaminhamento automático
- [ ] Mala direta / envio personalizado em massa
- [ ] Leitura em voz alta
- [ ] Modo de leitura imersiva
- [ ] Abrir e salvar EML
- [ ] Abrir e salvar MSG quando tecnicamente viável
- [ ] Abrir e reutilizar modelos OFT quando tecnicamente viável
- [ ] Importar e exportar regras
- [ ] Favoritar categorias
- [ ] Ações por gesto quando suportadas pela plataforma

---

## Organização

### Pastas

- [ ] Caixa de entrada
- [ ] Rascunhos
- [ ] Enviados
- [ ] Arquivados
- [ ] Spam
- [ ] Lixeira
- [ ] Pastas personalizadas
- [ ] Subpastas
- [ ] Renomear pasta
- [ ] Excluir pasta
- [ ] Reordenar pastas
- [ ] Favoritar pastas
- [ ] Contadores por pasta
- [ ] Ir diretamente para uma pasta
- [ ] Pastas compartilhadas
- [ ] Arquivo de caixa compartilhada

### Categorias

- [ ] Criar categorias
- [ ] Editar categorias
- [ ] Excluir categorias
- [ ] Aplicar múltiplas categorias
- [ ] Cores por categoria
- [ ] Filtro por categoria
- [ ] Pesquisa por categoria

### Favoritos

- [ ] Pastas favoritas
- [ ] Contatos favoritos
- [ ] Itens fixados

---

## Pesquisa

- [ ] Pesquisa global
- [ ] Pesquisa em todas as caixas
- [ ] Pesquisa em caixas compartilhadas
- [ ] Pesquisa por conta
- [ ] Pesquisa por pasta
- [ ] Pesquisa por remetente
- [ ] Pesquisa por destinatário
- [ ] Pesquisa por assunto
- [ ] Pesquisa no corpo
- [ ] Pesquisa por data
- [ ] Pesquisa por intervalo de datas
- [ ] Pesquisa por anexos
- [ ] Pesquisa por nome de arquivo
- [ ] Pesquisa por categoria
- [ ] Pesquisa por status
- [ ] Pesquisa por mensagens sinalizadas
- [ ] Pesquisa por mensagens não lidas
- [ ] Pesquisa por tamanho
- [ ] Operadores avançados
- [ ] Histórico de pesquisa
- [ ] Sugestões
- [ ] Pastas de pesquisa
- [ ] Pesquisas salvas

---

## Filtros

- [ ] Todas
- [ ] Não lidas
- [ ] Sinalizadas
- [ ] Com anexos
- [ ] Mencionando o usuário
- [ ] Por categoria
- [ ] Por período
- [ ] Por remetente
- [ ] Por prioridade

---

## Regras e automações

- [ ] Criar regras
- [ ] Editar regras
- [ ] Excluir regras
- [ ] Ativar/desativar regras
- [ ] Alterar prioridade
- [ ] Executar regras manualmente
- [ ] Regras por remetente
- [ ] Regras por destinatário
- [ ] Regras por assunto
- [ ] Regras por palavras
- [ ] Regras por domínio
- [ ] Regras por tamanho
- [ ] Regras por anexo
- [ ] Regras por prioridade
- [ ] Mover automaticamente
- [ ] Copiar automaticamente
- [ ] Arquivar automaticamente
- [ ] Marcar como lida
- [ ] Marcar com categoria
- [ ] Sinalizar
- [ ] Excluir
- [ ] Encaminhar
- [ ] Redirecionar quando suportado
- [ ] Parar processamento de outras regras

---

## Spam e remetentes

- [ ] Filtro de spam
- [ ] Lista de remetentes bloqueados
- [ ] Lista de remetentes confiáveis
- [ ] Bloqueio por domínio
- [ ] Liberação de remetente
- [ ] Denúncia de phishing
- [ ] Visualização segura de links
- [ ] Bloqueio de conteúdo remoto
- [ ] Permissão de imagens por remetente

---

# Contas

## Múltiplas contas

- [ ] Adicionar várias contas
- [ ] Remover conta
- [ ] Renomear conta
- [ ] Definir conta padrão
- [ ] Identidade visual por conta
- [ ] Assinatura por conta
- [ ] Configurações por conta
- [ ] Sincronização independente
- [ ] Perfis separados de e-mail
- [ ] Perfis com conjuntos diferentes de contas e configurações
- [ ] Aliases por conta

## Caixas compartilhadas e delegação

- [ ] Adicionar caixa compartilhada
- [ ] Caixa compartilhada como recurso
- [ ] Caixa compartilhada como conta
- [ ] Pastas compartilhadas
- [ ] Calendário compartilhado
- [ ] Arquivo compartilhado
- [ ] Contagem de não lidas em caixas compartilhadas
- [ ] Notificações por caixa compartilhada
- [ ] Regras por caixa compartilhada
- [ ] Respostas automáticas por caixa compartilhada
- [ ] Enviar como
- [ ] Enviar em nome de
- [ ] Acesso delegado
- [ ] Permissões de leitura
- [ ] Permissões de edição
- [ ] Permissões de gerenciamento de calendário

## Protocolos e provedores

- [ ] IMAP
- [ ] SMTP
- [ ] POP3
- [ ] OAuth 2.0
- [ ] Authorization Code + PKCE
- [ ] Renovação segura de tokens
- [ ] Descoberta automática de configuração
- [ ] CalDAV
- [ ] CardDAV
- [ ] APIs nativas de provedores quando necessárias
- [ ] Autenticação por senha quando suportada
- [ ] Gmail
- [ ] Yahoo
- [ ] iCloud Mail
- [ ] Microsoft 365
- [ ] Conta Microsoft
- [ ] Servidores corporativos
- [ ] Servidores personalizados
- [ ] Diretórios LDAP quando disponíveis

## Configuração avançada

- [ ] Configuração automática
- [ ] Configuração manual
- [ ] Porta IMAP
- [ ] Porta POP
- [ ] Porta SMTP
- [ ] SSL/TLS
- [ ] STARTTLS
- [ ] Timeout configurável
- [ ] Validação de certificado
- [ ] Teste de conexão

---

# Calendário

## Calendários

- [ ] Múltiplos calendários
- [ ] Calendários por conta
- [ ] Calendários compartilhados
- [ ] Calendários locais
- [ ] Mostrar/ocultar calendários
- [ ] Cores personalizadas

## Visualizações

- [ ] Dia
- [ ] Semana
- [ ] Semana útil
- [ ] Mês
- [ ] Agenda
- [ ] Visualização de 3 dias
- [ ] Calendários lado a lado
- [ ] Hoje

## Eventos

- [ ] Criar evento
- [ ] Editar evento
- [ ] Excluir evento
- [ ] Duplicar evento
- [ ] Arrastar evento
- [ ] Redimensionar evento
- [ ] Local
- [ ] Descrição
- [ ] Participantes
- [ ] Participantes obrigatórios
- [ ] Participantes opcionais
- [ ] Salas e recursos
- [ ] Evento de dia inteiro
- [ ] Evento privado
- [ ] Lembretes
- [ ] Recorrência
- [ ] Exceções de recorrência
- [ ] Editar somente esta ocorrência
- [ ] Editar esta e as próximas ocorrências
- [ ] Copiar, recortar e colar eventos
- [ ] Anexos
- [ ] Categorias

## Reuniões

- [ ] Criar reunião
- [ ] Salvar reunião como rascunho
- [ ] Convidar participantes
- [ ] Assistente de agendamento
- [ ] Consulta de disponibilidade livre/ocupado
- [ ] Sugestão de horários disponíveis
- [ ] Detecção de conflitos de agenda
- [ ] Reserva de salas e recursos
- [ ] Responder convite
- [ ] Aceitar
- [ ] Aceitar provisoriamente
- [ ] Recusar
- [ ] Manter reunião recusada no calendário
- [ ] Manter convite na caixa de entrada após responder
- [ ] Acompanhar reunião sem bloquear o horário quando suportado
- [ ] Sugerir novo horário quando suportado
- [ ] Acompanhar respostas
- [ ] Atualizar participantes
- [ ] Enviar atualização somente para participantes adicionados/removidos
- [ ] Cancelar reunião
- [ ] Adicionar reunião online por integração
- [ ] Recusar automaticamente convites em conflito
- [ ] Iniciar reuniões mais tarde ou terminar mais cedo
- [ ] Calendários de grupo
- [ ] Compartilhar calendário
- [ ] Permissões de calendário
- [ ] Delegação de calendário

## Compatibilidade

- [ ] Importar ICS
- [ ] Exportar ICS
- [ ] Abrir convites ICS
- [ ] Fusos horários
- [ ] Múltiplos fusos horários
- [ ] Horário de trabalho
- [ ] Dias úteis configuráveis
- [ ] Local de trabalho
- [ ] Horário de trabalho por dia
- [ ] Calendários de feriados
- [ ] Importação de feriados personalizados quando suportado

---

# Contatos

## Pessoas

- [ ] Criar contato
- [ ] Editar contato
- [ ] Excluir contato
- [ ] Foto
- [ ] Nome
- [ ] Sobrenome
- [ ] Apelido
- [ ] Empresa
- [ ] Cargo
- [ ] E-mails
- [ ] Telefones
- [ ] Endereços
- [ ] Datas importantes
- [ ] Observações

## Organização

- [ ] Contatos favoritos
- [ ] Categorias
- [ ] Grupos
- [ ] Listas de contatos
- [ ] Catálogo global de endereços
- [ ] Diretório corporativo
- [ ] Consulta LDAP
- [ ] Grupos de distribuição
- [ ] Destinatários sugeridos
- [ ] Pesquisa
- [ ] Mesclar duplicados
- [ ] Detecção de duplicados
- [ ] Edição em massa
- [ ] Exclusão em massa

## Importação e exportação

- [ ] CSV
- [ ] vCard
- [ ] Backup de contatos

## Compartilhamento

- [ ] Contatos compartilhados quando suportados pelo provedor
- [ ] Listas compartilhadas
- [ ] Diretórios corporativos somente leitura

---

# Tarefas

- [ ] Criar tarefa
- [ ] Editar tarefa
- [ ] Excluir tarefa
- [ ] Marcar como concluída
- [ ] Prioridade
- [ ] Data de início
- [ ] Data de vencimento
- [ ] Lembretes
- [ ] Recorrência
- [ ] Categorias
- [ ] Notas
- [ ] Listas personalizadas
- [ ] Transformar e-mail em tarefa
- [ ] Abrir e-mail relacionado
- [ ] Visualização de tarefas do dia
- [ ] Tarefas atrasadas
- [ ] Tarefas concluídas
- [ ] Minha agenda / Meu dia
- [ ] Tarefas para hoje
- [ ] Próximas tarefas
- [ ] E-mails sinalizados como tarefas

---

# Notas

- [ ] Criar nota
- [ ] Editar nota
- [ ] Excluir nota
- [ ] Pesquisa em notas
- [ ] Categorias
- [ ] Fixar notas
- [ ] Armazenamento local
- [ ] Sincronização quando suportada pelo provedor

---

# Offline

O Seven Mail deverá continuar funcional mesmo sem conexão.

- [ ] Cache local de mensagens
- [ ] Cache de anexos selecionados
- [ ] Leitura offline
- [ ] Pesquisa offline
- [ ] Rascunhos offline
- [ ] Respostas offline
- [ ] Encaminhamentos offline
- [ ] Caixa de saída offline
- [ ] Sincronização automática após reconexão
- [ ] Calendário offline
- [ ] Contatos offline
- [ ] Tarefas offline
- [ ] Indicador de estado da sincronização
- [ ] Resolução de conflitos
- [ ] Sincronização incremental
- [ ] Configuração do período armazenado localmente

---

# Notificações

- [ ] Nova mensagem
- [ ] Mensagem importante
- [ ] Lembrete de evento
- [ ] Lembrete de tarefa
- [ ] Configuração por conta
- [ ] Configuração por pasta
- [ ] Silenciar conta
- [ ] Silenciar conversa
- [ ] Horário silencioso
- [ ] Ações rápidas pela notificação

---

# Importação e exportação

## Importação

- [ ] Mensagens
- [ ] Pastas
- [ ] Contatos
- [ ] Calendários
- [ ] Tarefas
- [ ] Arquivos EML
- [ ] Arquivos MSG quando tecnicamente viável
- [ ] Arquivos OFT quando tecnicamente viável
- [ ] Arquivos MBOX
- [ ] Arquivos PST quando tecnicamente disponível
- [ ] CSV
- [ ] ICS
- [ ] vCard
- [ ] Configurações do aplicativo
- [ ] Regras
- [ ] Perfis

## Exportação

- [ ] EML
- [ ] MBOX
- [ ] CSV
- [ ] ICS
- [ ] vCard
- [ ] Regras
- [ ] Configurações
- [ ] Perfis
- [ ] Backup completo do perfil
- [ ] Backup criptografado

---

# Segurança e privacidade

- [ ] Credenciais armazenadas com segurança
- [ ] Keychain/Keyring do sistema operacional
- [ ] OAuth 2.0
- [ ] TLS
- [ ] Validação de certificado
- [ ] Proteção contra conteúdo remoto
- [ ] Proteção contra rastreamento por pixels
- [ ] Sanitização de HTML
- [ ] Proteção contra XSS
- [ ] Bloqueio de URLs perigosas
- [ ] Avisos para links suspeitos
- [ ] Aviso de remetente externo
- [ ] Bloqueio de anexos perigosos
- [ ] Exibição de resultados SPF, DKIM e DMARC quando disponíveis
- [ ] Suporte a autenticação em duas etapas do provedor
- [ ] Criptografia do armazenamento local
- [ ] Bloqueio do aplicativo
- [ ] Sessões protegidas
- [ ] Limpeza segura de dados locais
- [ ] Políticas de retenção quando oferecidas pelo provedor
- [ ] Rótulos de sensibilidade quando oferecidos pelo provedor
- [ ] Restrições de encaminhamento/cópia quando oferecidas pelo provedor

## Criptografia de e-mail

- [ ] S/MIME
- [ ] Assinatura digital
- [ ] Verificação de assinatura
- [ ] Criptografia de mensagens quando suportada

---

# Configurações

## Aparência

- [ ] Tema claro
- [ ] Tema escuro
- [ ] Seguir sistema
- [ ] Densidade confortável
- [ ] Densidade compacta
- [ ] Tamanho da fonte
- [ ] Personalização da lista de mensagens
- [ ] Painel de leitura à direita
- [ ] Painel de leitura abaixo
- [ ] Painel de leitura desativado
- [ ] Personalização do menu lateral
- [ ] Personalização de ações rápidas
- [ ] Personalização do painel de pastas
- [ ] Mostrar/ocultar fotos dos remetentes

## Comportamento

- [ ] Abrir próxima mensagem após excluir
- [ ] Marcar como lida automaticamente
- [ ] Tempo para marcar como lida
- [ ] Confirmação antes de excluir
- [ ] Confirmação antes de enviar
- [ ] Respostas automáticas
- [ ] Encaminhamento
- [ ] Atraso padrão de envio
- [ ] Comportamento do botão fechar
- [ ] Minimizar para bandeja
- [ ] Iniciar com o sistema

## Idioma e região

- [ ] Múltiplos idiomas
- [ ] Formato de data
- [ ] Formato de hora
- [ ] Primeiro dia da semana
- [ ] Fuso horário
- [ ] Verificação ortográfica
- [ ] Autocorreção
- [ ] Capitalização automática
- [ ] Dicionários personalizados

---

# Atalhos de teclado

- [ ] Novo e-mail
- [ ] Responder
- [ ] Responder a todos
- [ ] Encaminhar
- [ ] Arquivar
- [ ] Excluir
- [ ] Marcar como lida
- [ ] Marcar como não lida
- [ ] Pesquisa
- [ ] Próxima mensagem
- [ ] Mensagem anterior
- [ ] Abrir calendário
- [ ] Abrir contatos
- [ ] Abrir tarefas
- [ ] Atalhos personalizáveis

---

# Acessibilidade

- [ ] Navegação completa por teclado
- [ ] Leitores de tela
- [ ] Leitura em voz alta
- [ ] Leitura imersiva
- [ ] Ditado
- [ ] ARIA
- [ ] Alto contraste
- [ ] Escala de interface
- [ ] Foco visível
- [ ] Labels acessíveis
- [ ] Redução de animações
- [ ] Compatibilidade com configurações de acessibilidade do sistema

---

# Desempenho

- [ ] Inicialização rápida
- [ ] Carregamento incremental
- [ ] Virtualização da lista de mensagens
- [ ] Cache inteligente
- [ ] Sincronização incremental
- [ ] Paginação
- [ ] Indexação local
- [ ] Busca rápida
- [ ] Processamento de mensagens em background
- [ ] Limite de concorrência
- [ ] Retry com backoff
- [ ] Economia de memória
- [ ] Economia de bateria
- [ ] Suporte a caixas com grande volume de mensagens

---

# Sincronização

- [ ] Sincronização em background
- [ ] Sincronização por intervalo
- [ ] Push quando suportado
- [ ] Sincronização manual
- [ ] Sincronização por pasta
- [ ] Estado por conta
- [ ] Indicador de erros
- [ ] Retentativas automáticas
- [ ] Reconexão
- [ ] Detecção de alterações remotas
- [ ] Resolução de conflitos

---

# Experiência desktop

- [ ] Windows
- [ ] Linux
- [ ] macOS
- [ ] Bandeja do sistema
- [ ] Badge de mensagens não lidas
- [ ] Notificações nativas
- [ ] Protocolo mailto:
- [ ] Definir como cliente padrão
- [ ] Abrir arquivos EML
- [ ] Abrir arquivos MSG quando suportado
- [ ] Abrir arquivos OFT quando suportado
- [ ] Abrir arquivos ICS
- [ ] Arrastar arquivos para composição
- [ ] Arrastar anexos para área de trabalho
- [ ] Arrastar anexos para outros aplicativos
- [ ] Múltiplas janelas
- [ ] Atualizações automáticas

---

# Arquitetura planejada

O projeto deverá priorizar separação clara entre interface, domínio, sincronização, protocolos e armazenamento local.

```text
Seven Mail
├── Application
│   ├── Mail
│   ├── Calendar
│   ├── Contacts
│   ├── Tasks
│   ├── Search
│   └── Rules
│
├── Domain
│   ├── Accounts
│   ├── Messages
│   ├── Folders
│   ├── Events
│   ├── Contacts
│   ├── Tasks
│   ├── Notes
│   └── Shared Resources
│
├── Infrastructure
│   ├── IMAP
│   ├── POP3
│   ├── SMTP
│   ├── CalDAV
│   ├── CardDAV
│   ├── Provider APIs
│   ├── OAuth
│   ├── Directory
│   ├── Storage
│   ├── Search Index
│   └── Sync Engine
│
└── Presentation
    ├── Mail
    ├── Calendar
    ├── People
    ├── Tasks
    ├── Notes
    └── Settings
```

---

# Princípios do projeto

## Local-first

O aplicativo deverá continuar utilizável mesmo quando a conexão estiver indisponível.

Alterações feitas offline deverão ser persistidas localmente e sincronizadas com o servidor assim que possível.

## Segurança por padrão

Conteúdo de e-mail deve ser tratado como entrada não confiável.

HTML, links, anexos, imagens externas e credenciais precisam de tratamento específico para reduzir riscos de:

- XSS
- phishing
- rastreamento
- roubo de sessão
- anexos maliciosos
- vazamento de credenciais

## Independência de provedor

O núcleo da aplicação não deve depender de um único serviço.

Cada provedor deverá ser implementado através de adapters, permitindo adicionar ou substituir integrações sem alterar as regras centrais da aplicação.

## Performance

Caixas com dezenas ou centenas de milhares de mensagens não devem exigir que todo o conteúdo seja mantido em memória.

A aplicação deverá utilizar:

- Paginação
- Virtualização
- Indexação
- Cache
- Sincronização incremental
- Processamento em background
- Consultas otimizadas

---

# Roadmap

## 0.1.0 — Fundação

- [ ] Estrutura inicial do projeto
- [ ] Sistema de contas
- [ ] Armazenamento local
- [ ] IMAP
- [ ] SMTP
- [ ] OAuth 2.0 + PKCE
- [ ] Descoberta automática de contas
- [ ] Primeira sincronização
- [ ] Caixa de entrada
- [ ] Leitura de mensagem
- [ ] Envio de mensagem

## 0.2.0 — Cliente de e-mail

- [ ] Pastas
- [ ] Rascunhos
- [ ] Anexos
- [ ] Assinaturas
- [ ] Pesquisa
- [ ] Categorias
- [ ] Favoritos
- [ ] Spam
- [ ] Regras
- [ ] Caixa prioritária
- [ ] Ações rápidas
- [ ] Limpeza automática
- [ ] Respostas automáticas

## 0.3.0 — Múltiplas contas

- [ ] Caixa unificada
- [ ] OAuth
- [ ] Gmail
- [ ] Yahoo
- [ ] iCloud
- [ ] Microsoft 365
- [ ] Configuração manual
- [ ] Perfis
- [ ] Caixas compartilhadas
- [ ] Delegação
- [ ] Enviar como / em nome de
- [ ] Sincronização independente

## 0.4.0 — Offline

- [ ] Cache local
- [ ] Caixa de saída
- [ ] Pesquisa offline
- [ ] Sincronização incremental
- [ ] Resolução de conflitos

## 0.5.0 — Calendário

- [ ] CalDAV e/ou API do provedor
- [ ] Calendários
- [ ] Eventos
- [ ] Recorrência
- [ ] Convites
- [ ] Assistente de agendamento
- [ ] Livre/ocupado
- [ ] Compartilhamento e delegação
- [ ] ICS
- [ ] Lembretes

## 0.6.0 — Contatos

- [ ] CardDAV e/ou API do provedor
- [ ] Pessoas
- [ ] Favoritos
- [ ] Categorias
- [ ] Grupos
- [ ] Diretório corporativo / LDAP
- [ ] CSV
- [ ] vCard

## 0.7.0 — Tarefas

- [ ] Listas
- [ ] Prioridades
- [ ] Lembretes
- [ ] Recorrência
- [ ] Integração com e-mails
- [ ] Notas

## 0.8.0 — Produtividade

- [ ] Agendamento de envio
- [ ] Desfazer envio
- [ ] Modelos
- [ ] Pastas de pesquisa
- [ ] Pesquisa avançada
- [ ] Regras avançadas
- [ ] Formatação condicional
- [ ] Reenvio e recuperação de mensagens quando suportados
- [ ] Leitura em voz alta
- [ ] Leitura imersiva
- [ ] Mala direta

## 0.9.0 — Segurança e migração

- [ ] S/MIME
- [ ] Assinaturas digitais
- [ ] Importação
- [ ] Exportação
- [ ] Backup
- [ ] Criptografia local
- [ ] Regras e configurações importáveis/exportáveis
- [ ] Políticas corporativas quando suportadas pelo provedor

## 1.0.0 — Stable

- [ ] Windows
- [ ] Linux
- [ ] macOS
- [ ] Atualizador automático
- [ ] Instaladores
- [ ] Migração completa
- [ ] Testes de carga
- [ ] Testes de segurança
- [ ] Testes de sincronização
- [ ] Documentação completa
- [ ] Caixas compartilhadas e delegação validadas
- [ ] Calendário/contatos sincronizados por provedor
- [ ] Compatibilidade EML/ICS validada

---

# Extensões e integrações

- [ ] Arquitetura de extensões
- [ ] Integrações de reunião online
- [ ] Integrações com armazenamento em nuvem
- [ ] Ações externas seguras
- [ ] Permissões isoladas por extensão
- [ ] Ativar/desativar extensões individualmente

---

# Qualidade

Antes de qualquer versão estável, o Seven Mail deverá possuir testes para:

- Sincronização IMAP
- Envio SMTP
- Reconexão
- Expiração de autenticação
- Contas inválidas
- Certificados inválidos
- Mensagens malformadas
- HTML malicioso
- Anexos grandes
- Anexos perigosos
- Mensagens com MIME complexo
- Encoding
- Unicode
- Grandes caixas de entrada
- Sincronização concorrente
- Operação offline
- Conflitos de sincronização
- Calendários recorrentes
- Disponibilidade livre/ocupado
- Delegação e caixas compartilhadas
- CalDAV
- CardDAV
- Diretórios corporativos
- Importação e exportação

---

# Contribuição

O projeto está em desenvolvimento.

Issues e Pull Requests poderão ser utilizados para:

- Bugs
- Melhorias
- Novos provedores
- Compatibilidade
- Performance
- Segurança
- Interface
- Acessibilidade

---

## Autor

Desenvolvido por [gabriell211](https://github.com/gabriell211).

---

<p align="center">
  <strong>Seven Mail</strong><br />
  Mail. Calendar. People. Tasks.
</p>
