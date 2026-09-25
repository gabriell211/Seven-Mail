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

> **Status:** 1.0 estável — desenvolvimento contínuo. A linha desktop 1.0.x já possui cliente local-first funcional para Windows e Linux, com IMAP/SMTP, múltiplas contas, caixa unificada, composição, fila offline, regras, pesquisa avançada, calendário local, contatos, tarefas, notas e sincronização opcional com Neon.

### Seven Mail 1.0

O checklist funcional definido neste README está concluído. Recursos dependentes de servidor, tenant ou provedor usam detecção de capacidade e só são habilitados quando a infraestrutura remota oferece suporte.

### Estado atual

A implementação atual já inclui:

- Cliente desktop Tauri 2 com React 19 + TypeScript e backend Rust.
- Identidade visual oficial integrada à interface, favicon e geração dos ícones nativos do desktop.
- Tela de inicialização premium com o 7 preenchendo de baixo para cima, ligada ao bootstrap local-first real.
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
- Lembretes nativos de tarefas e eventos, além de notificações de novas mensagens.
- Importação e exportação local de EML, ICS, CSV e vCard.
- Backup/restauração local de workspace, preferências e metadados de contas (sem exportar credenciais).
- Calendário com visualizações de dia, semana, mês e agenda; tarefas com filtros de hoje, atrasadas e próximas.
- Atalhos de teclado para navegação e ações principais de mensagens.
- Credenciais mantidas no Credential Manager/Keyring do sistema operacional.
- Sincronização cloud opcional via Neon para metadados e workspace; credenciais de e-mail não são enviadas ao Neon.

A linha 1.0 inclui os módulos avançados de protocolo e interoperabilidade previstos no checklist, com disponibilidade final condicionada às capacidades, permissões e credenciais de cada provedor/servidor.

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

- [x] Caixa de entrada por conta
- [x] Caixa de entrada unificada
- [x] Caixa prioritária e Outros
- [x] Ativar/desativar caixa prioritária
- [x] Visualização por conversa
- [x] Visualização individual de mensagens
- [x] Contagem de mensagens não lidas
- [x] Atualização automática
- [x] Sincronização manual
- [x] Paginação eficiente
- [x] Carregamento incremental
- [x] Pré-visualização da mensagem
- [x] Uma ou duas linhas de pré-visualização configuráveis
- [x] Ordenação por remetente, assunto, data, tamanho e status
- [x] Formatação condicional da lista de mensagens
- [x] Cabeçalhos recolhíveis na lista
- [x] Ações rápidas configuráveis na lista
- [x] Painel de leitura configurável
- [x] Abrir mensagem em nova janela
- [x] Abrir múltiplas mensagens simultaneamente

### Mensagens

- [x] Enviar e-mail
- [x] Responder
- [x] Responder a todos
- [x] Encaminhar
- [x] Encaminhar como anexo
- [x] Editar rascunhos
- [x] Salvar rascunhos automaticamente
- [x] Excluir mensagens
- [x] Restaurar mensagens excluídas
- [x] Arquivar
- [x] Marcar como lida
- [x] Marcar como não lida
- [x] Fixar mensagem
- [x] Sinalizar mensagem
- [x] Remover sinalização
- [x] Adiar mensagem
- [x] Mover para pasta
- [x] Copiar para pasta
- [x] Imprimir mensagem
- [x] Salvar mensagem
- [x] Exibir cabeçalhos completos
- [x] Visualizar código-fonte da mensagem
- [x] Marcar como spam
- [x] Marcar como phishing
- [x] Bloquear remetente
- [x] Liberar remetente
- [x] Ignorar conversa
- [x] Silenciar conversa
- [x] Reenviar mensagem
- [x] Recuperar/recolher mensagem enviada quando suportado pelo provedor (capability detection + API nativa quando disponível)
- [x] Reações em mensagens quando suportadas (fallback SMTP interoperável e respeito à política do provedor)
- [x] Arrastar mensagens entre pastas
- [x] Arrastar mensagens entre contas quando suportado (IMAP APPEND/transferência entre contas compatíveis)
- [x] Criar evento a partir de um e-mail
- [x] Criar tarefa a partir de um e-mail

### Composição

- [x] Editor de texto rico
- [x] Texto simples
- [x] HTML
- [x] Negrito
- [x] Itálico
- [x] Sublinhado
- [x] Tachado
- [x] Listas
- [x] Recuo
- [x] Alinhamento
- [x] Links
- [x] Tabelas
- [x] Imagens inline
- [x] Emojis
- [x] Campo De selecionável
- [x] Envio usando aliases
- [x] Corretor ortográfico
- [x] Correção automática
- [x] Capitalização automática
- [x] Dicionários por idioma
- [x] Ditado por voz quando disponível no sistema
- [x] Assinaturas
- [x] Assinatura diferente por conta
- [x] Assinatura para novas mensagens
- [x] Assinatura para respostas
- [x] CC
- [x] CCO
- [x] Prioridade
- [x] Confirmação de leitura quando suportada
- [x] Confirmação de entrega quando suportada
- [x] Programar envio
- [x] Atraso padrão antes do envio
- [x] Desfazer envio
- [x] Modelos de mensagem
- [x] Modelos baseados em arquivo quando suportado
- [x] Reutilização de blocos de conteúdo
- [x] Pré-visualização de links
- [x] Verificação de destinatários
- [x] Aviso de anexo esquecido
- [x] Aviso de assunto vazio

### Anexos

- [x] Upload por botão
- [x] Arrastar e soltar
- [x] Download
- [x] Download de todos
- [x] Pré-visualização
- [x] Imagens
- [x] PDFs
- [x] Documentos
- [x] Planilhas
- [x] Arquivos compactados
- [x] Limite configurável
- [x] Indicador de progresso
- [x] Cancelamento de upload
- [x] Bloqueio de extensões perigosas
- [x] Arrastar anexos para a área de trabalho
- [x] Arrastar anexos para outros aplicativos
- [x] Mover anexos entre mensagens e contas quando permitido (reutilização/staging respeitando direitos de cópia)

### Produtividade de e-mail

- [x] Ações rápidas compostas por múltiplas etapas
- [x] Atalhos para ações rápidas
- [x] Limpeza automática por remetente
- [x] Ignorar e limpar conversas
- [x] Respostas automáticas / ausência temporária
- [x] Encaminhamento automático
- [x] Mala direta / envio personalizado em massa
- [x] Leitura em voz alta
- [x] Modo de leitura imersiva
- [x] Abrir e salvar EML
- [x] Abrir e salvar MSG quando tecnicamente viável
- [x] Abrir e reutilizar modelos OFT quando tecnicamente viável
- [x] Importar e exportar regras
- [x] Favoritar categorias
- [x] Ações por gesto quando suportadas pela plataforma

---

## Organização

### Pastas

- [x] Caixa de entrada
- [x] Rascunhos
- [x] Enviados
- [x] Arquivados
- [x] Spam
- [x] Lixeira
- [x] Pastas personalizadas
- [x] Subpastas
- [x] Renomear pasta
- [x] Excluir pasta
- [x] Reordenar pastas
- [x] Favoritar pastas
- [x] Contadores por pasta
- [x] Ir diretamente para uma pasta
- [x] Pastas compartilhadas
- [x] Arquivo de caixa compartilhada

### Categorias

- [x] Criar categorias
- [x] Editar categorias
- [x] Excluir categorias
- [x] Aplicar múltiplas categorias
- [x] Cores por categoria
- [x] Filtro por categoria
- [x] Pesquisa por categoria

### Favoritos

- [x] Pastas favoritas
- [x] Contatos favoritos
- [x] Itens fixados

---

## Pesquisa

- [x] Pesquisa global
- [x] Pesquisa em todas as caixas
- [x] Pesquisa em caixas compartilhadas
- [x] Pesquisa por conta
- [x] Pesquisa por pasta
- [x] Pesquisa por remetente
- [x] Pesquisa por destinatário
- [x] Pesquisa por assunto
- [x] Pesquisa no corpo
- [x] Pesquisa por data
- [x] Pesquisa por intervalo de datas
- [x] Pesquisa por anexos
- [x] Pesquisa por nome de arquivo
- [x] Pesquisa por categoria
- [x] Pesquisa por status
- [x] Pesquisa por mensagens sinalizadas
- [x] Pesquisa por mensagens não lidas
- [x] Pesquisa por tamanho
- [x] Operadores avançados
- [x] Histórico de pesquisa
- [x] Sugestões
- [x] Pastas de pesquisa
- [x] Pesquisas salvas

---

## Filtros

- [x] Todas
- [x] Não lidas
- [x] Sinalizadas
- [x] Com anexos
- [x] Mencionando o usuário
- [x] Por categoria
- [x] Por período
- [x] Por remetente
- [x] Por prioridade

---

## Regras e automações

- [x] Criar regras
- [x] Editar regras
- [x] Excluir regras
- [x] Ativar/desativar regras
- [x] Alterar prioridade
- [x] Executar regras manualmente
- [x] Regras por remetente
- [x] Regras por destinatário
- [x] Regras por assunto
- [x] Regras por palavras
- [x] Regras por domínio
- [x] Regras por tamanho
- [x] Regras por anexo
- [x] Regras por prioridade
- [x] Mover automaticamente
- [x] Copiar automaticamente
- [x] Arquivar automaticamente
- [x] Marcar como lida
- [x] Marcar com categoria
- [x] Sinalizar
- [x] Excluir
- [x] Encaminhar
- [x] Redirecionar quando suportado
- [x] Parar processamento de outras regras

---

## Spam e remetentes

- [x] Filtro de spam
- [x] Lista de remetentes bloqueados
- [x] Lista de remetentes confiáveis
- [x] Bloqueio por domínio
- [x] Liberação de remetente
- [x] Denúncia de phishing
- [x] Visualização segura de links
- [x] Bloqueio de conteúdo remoto
- [x] Permissão de imagens por remetente

---

# Contas

## Múltiplas contas

- [x] Adicionar várias contas
- [x] Remover conta
- [x] Renomear conta
- [x] Definir conta padrão
- [x] Identidade visual por conta
- [x] Assinatura por conta
- [x] Configurações por conta
- [x] Sincronização independente
- [x] Perfis separados de e-mail
- [x] Perfis com conjuntos diferentes de contas e configurações
- [x] Aliases por conta

## Caixas compartilhadas e delegação

- [x] Adicionar caixa compartilhada
- [x] Caixa compartilhada como recurso
- [x] Caixa compartilhada como conta
- [x] Pastas compartilhadas
- [x] Calendário compartilhado
- [x] Arquivo compartilhado
- [x] Contagem de não lidas em caixas compartilhadas
- [x] Notificações por caixa compartilhada
- [x] Regras por caixa compartilhada
- [x] Respostas automáticas por caixa compartilhada
- [x] Enviar como
- [x] Enviar em nome de
- [x] Acesso delegado
- [x] Permissões de leitura
- [x] Permissões de edição
- [x] Permissões de gerenciamento de calendário

## Protocolos e provedores

- [x] IMAP
- [x] SMTP
- [x] POP3
- [x] OAuth 2.0
- [x] Authorization Code + PKCE
- [x] Renovação segura de tokens
- [x] Descoberta automática de configuração
- [x] CalDAV
- [x] CardDAV
- [x] APIs nativas de provedores quando necessárias (adapter Microsoft Graph com capability detection)
- [x] Autenticação por senha quando suportada
- [x] Gmail
- [x] Yahoo
- [x] iCloud Mail
- [x] Microsoft 365
- [x] Conta Microsoft
- [x] Servidores corporativos
- [x] Servidores personalizados
- [x] Diretórios LDAP quando disponíveis

## Configuração avançada

- [x] Configuração automática
- [x] Configuração manual
- [x] Porta IMAP
- [x] Porta POP
- [x] Porta SMTP
- [x] SSL/TLS
- [x] STARTTLS
- [x] Timeout configurável
- [x] Validação de certificado
- [x] Teste de conexão

---

# Calendário

## Calendários

- [x] Múltiplos calendários
- [x] Calendários por conta
- [x] Calendários compartilhados
- [x] Calendários locais
- [x] Mostrar/ocultar calendários
- [x] Cores personalizadas

## Visualizações

- [x] Dia
- [x] Semana
- [x] Semana útil
- [x] Mês
- [x] Agenda
- [x] Visualização de 3 dias
- [x] Calendários lado a lado
- [x] Hoje

## Eventos

- [x] Criar evento
- [x] Editar evento
- [x] Excluir evento
- [x] Duplicar evento
- [x] Arrastar evento
- [x] Redimensionar evento
- [x] Local
- [x] Descrição
- [x] Participantes
- [x] Participantes obrigatórios
- [x] Participantes opcionais
- [x] Salas e recursos
- [x] Evento de dia inteiro
- [x] Evento privado
- [x] Lembretes
- [x] Recorrência
- [x] Exceções de recorrência
- [x] Editar somente esta ocorrência
- [x] Editar esta e as próximas ocorrências
- [x] Copiar, recortar e colar eventos
- [x] Anexos
- [x] Categorias

## Reuniões

- [x] Criar reunião
- [x] Salvar reunião como rascunho
- [x] Convidar participantes
- [x] Assistente de agendamento
- [x] Consulta de disponibilidade livre/ocupado
- [x] Sugestão de horários disponíveis
- [x] Detecção de conflitos de agenda
- [x] Reserva de salas e recursos
- [x] Responder convite
- [x] Aceitar
- [x] Aceitar provisoriamente
- [x] Recusar
- [x] Manter reunião recusada no calendário
- [x] Manter convite na caixa de entrada após responder
- [x] Acompanhar reunião sem bloquear o horário quando suportado
- [x] Sugerir novo horário quando suportado
- [x] Acompanhar respostas
- [x] Atualizar participantes
- [x] Enviar atualização somente para participantes adicionados/removidos
- [x] Cancelar reunião
- [x] Adicionar reunião online por integração
- [x] Recusar automaticamente convites em conflito
- [x] Iniciar reuniões mais tarde ou terminar mais cedo
- [x] Calendários de grupo
- [x] Compartilhar calendário
- [x] Permissões de calendário
- [x] Delegação de calendário

## Compatibilidade

- [x] Importar ICS
- [x] Exportar ICS
- [x] Abrir convites ICS
- [x] Fusos horários
- [x] Múltiplos fusos horários
- [x] Horário de trabalho
- [x] Dias úteis configuráveis
- [x] Local de trabalho
- [x] Horário de trabalho por dia
- [x] Calendários de feriados
- [x] Importação de feriados personalizados quando suportado

---

# Contatos

## Pessoas

- [x] Criar contato
- [x] Editar contato
- [x] Excluir contato
- [x] Foto
- [x] Nome
- [x] Sobrenome
- [x] Apelido
- [x] Empresa
- [x] Cargo
- [x] E-mails
- [x] Telefones
- [x] Endereços
- [x] Datas importantes
- [x] Observações

## Organização

- [x] Contatos favoritos
- [x] Categorias
- [x] Grupos
- [x] Listas de contatos
- [x] Catálogo global de endereços
- [x] Diretório corporativo
- [x] Consulta LDAP
- [x] Grupos de distribuição
- [x] Destinatários sugeridos
- [x] Pesquisa
- [x] Mesclar duplicados
- [x] Detecção de duplicados
- [x] Edição em massa
- [x] Exclusão em massa

## Importação e exportação

- [x] CSV
- [x] vCard
- [x] Backup de contatos

## Compartilhamento

- [x] Contatos compartilhados quando suportados pelo provedor
- [x] Listas compartilhadas
- [x] Diretórios corporativos somente leitura

---

# Tarefas

- [x] Criar tarefa
- [x] Editar tarefa
- [x] Excluir tarefa
- [x] Marcar como concluída
- [x] Prioridade
- [x] Data de início
- [x] Data de vencimento
- [x] Lembretes
- [x] Recorrência
- [x] Categorias
- [x] Notas
- [x] Listas personalizadas
- [x] Transformar e-mail em tarefa
- [x] Abrir e-mail relacionado
- [x] Visualização de tarefas do dia
- [x] Tarefas atrasadas
- [x] Tarefas concluídas
- [x] Minha agenda / Meu dia
- [x] Tarefas para hoje
- [x] Próximas tarefas
- [x] E-mails sinalizados como tarefas

---

# Notas

- [x] Criar nota
- [x] Editar nota
- [x] Excluir nota
- [x] Pesquisa em notas
- [x] Categorias
- [x] Fixar notas
- [x] Armazenamento local
- [x] Sincronização quando suportada pelo provedor

---

# Offline

O Seven Mail deverá continuar funcional mesmo sem conexão.

- [x] Cache local de mensagens
- [x] Cache de anexos selecionados
- [x] Leitura offline
- [x] Pesquisa offline
- [x] Rascunhos offline
- [x] Respostas offline
- [x] Encaminhamentos offline
- [x] Caixa de saída offline
- [x] Sincronização automática após reconexão
- [x] Calendário offline
- [x] Contatos offline
- [x] Tarefas offline
- [x] Indicador de estado da sincronização
- [x] Resolução de conflitos
- [x] Sincronização incremental
- [x] Configuração do período armazenado localmente

---

# Notificações

- [x] Nova mensagem
- [x] Mensagem importante
- [x] Lembrete de evento
- [x] Lembrete de tarefa
- [x] Configuração por conta
- [x] Configuração por pasta
- [x] Silenciar conta
- [x] Silenciar conversa
- [x] Horário silencioso
- [x] Ações rápidas pela notificação (toast acionável desktop: abrir, marcar como lida e arquivar; notificação nativa acompanha o aviso)

---

# Importação e exportação

## Importação

- [x] Mensagens
- [x] Pastas
- [x] Contatos
- [x] Calendários
- [x] Tarefas
- [x] Arquivos EML
- [x] Arquivos MSG quando tecnicamente viável
- [x] Arquivos OFT quando tecnicamente viável
- [x] Arquivos MBOX
- [x] Arquivos PST quando tecnicamente disponível (importação e exportação pelo módulo nativo de migração)
- [x] CSV
- [x] ICS
- [x] vCard
- [x] Configurações do aplicativo
- [x] Regras
- [x] Perfis

## Exportação

- [x] EML
- [x] MBOX
- [x] CSV
- [x] ICS
- [x] vCard
- [x] Regras
- [x] Configurações
- [x] Perfis
- [x] Backup completo do perfil
- [x] Backup criptografado

---

# Segurança e privacidade

- [x] Credenciais armazenadas com segurança
- [x] Keychain/Keyring do sistema operacional
- [x] OAuth 2.0
- [x] TLS
- [x] Validação de certificado
- [x] Proteção contra conteúdo remoto
- [x] Proteção contra rastreamento por pixels
- [x] Sanitização de HTML
- [x] Proteção contra XSS
- [x] Bloqueio de URLs perigosas
- [x] Avisos para links suspeitos
- [x] Aviso de remetente externo
- [x] Bloqueio de anexos perigosos
- [x] Exibição de resultados SPF, DKIM e DMARC quando disponíveis
- [x] Suporte a autenticação em duas etapas do provedor
- [x] Criptografia do armazenamento local
- [x] Bloqueio do aplicativo
- [x] Sessões protegidas
- [x] Limpeza segura de dados locais
- [x] Políticas de retenção quando oferecidas pelo provedor (catálogo nativo e capability detection)
- [x] Rótulos de sensibilidade quando oferecidos pelo provedor (catálogo, identificação em mensagem e direitos de uso)
- [x] Restrições de encaminhamento/cópia quando oferecidas pelo provedor (ações bloqueadas conforme direitos retornados)

## Criptografia de e-mail

- [x] S/MIME
- [x] Assinatura digital (CMS/PKCS#7 com identidade PKCS#12)
- [x] Verificação de assinatura (integridade CMS/PKCS#7 na leitura)
- [x] Criptografia de mensagens quando suportada (S/MIME com certificados X.509 dos destinatários)

---

# Configurações

## Aparência

- [x] Tema claro
- [x] Tema escuro
- [x] Seguir sistema
- [x] Densidade confortável
- [x] Densidade compacta
- [x] Tamanho da fonte
- [x] Personalização da lista de mensagens
- [x] Painel de leitura à direita
- [x] Painel de leitura abaixo
- [x] Painel de leitura desativado
- [x] Personalização do menu lateral
- [x] Personalização de ações rápidas
- [x] Personalização do painel de pastas
- [x] Mostrar/ocultar fotos dos remetentes

## Comportamento

- [x] Abrir próxima mensagem após excluir
- [x] Marcar como lida automaticamente
- [x] Tempo para marcar como lida
- [x] Confirmação antes de excluir
- [x] Confirmação antes de enviar
- [x] Respostas automáticas
- [x] Encaminhamento
- [x] Atraso padrão de envio
- [x] Comportamento do botão fechar
- [x] Minimizar para bandeja
- [x] Iniciar com o sistema

## Idioma e região

- [x] Múltiplos idiomas
- [x] Formato de data
- [x] Formato de hora
- [x] Primeiro dia da semana
- [x] Fuso horário
- [x] Verificação ortográfica
- [x] Autocorreção
- [x] Capitalização automática
- [x] Dicionários personalizados

---

# Atalhos de teclado

- [x] Novo e-mail
- [x] Responder
- [x] Responder a todos
- [x] Encaminhar
- [x] Arquivar
- [x] Excluir
- [x] Marcar como lida
- [x] Marcar como não lida
- [x] Pesquisa
- [x] Próxima mensagem
- [x] Mensagem anterior
- [x] Abrir calendário
- [x] Abrir contatos
- [x] Abrir tarefas
- [x] Atalhos personalizáveis

---

# Acessibilidade

- [x] Navegação completa por teclado
- [x] Leitores de tela
- [x] Leitura em voz alta
- [x] Leitura imersiva
- [x] Ditado
- [x] ARIA
- [x] Alto contraste
- [x] Escala de interface
- [x] Foco visível
- [x] Labels acessíveis
- [x] Redução de animações
- [x] Compatibilidade com configurações de acessibilidade do sistema

---

# Desempenho

- [x] Inicialização rápida
- [x] Carregamento incremental
- [x] Virtualização da lista de mensagens
- [x] Cache inteligente
- [x] Sincronização incremental
- [x] Paginação
- [x] Indexação local
- [x] Busca rápida
- [x] Processamento de mensagens em background
- [x] Limite de concorrência
- [x] Retry com backoff
- [x] Economia de memória
- [x] Economia de bateria
- [x] Suporte a caixas com grande volume de mensagens

---

# Sincronização

- [x] Sincronização em background
- [x] Sincronização por intervalo
- [x] Push quando suportado (IMAP IDLE/push para contas compatíveis; fallback por intervalo)
- [x] Sincronização manual
- [x] Sincronização por pasta
- [x] Estado por conta
- [x] Indicador de erros
- [x] Retentativas automáticas
- [x] Reconexão
- [x] Detecção de alterações remotas
- [x] Resolução de conflitos

---

# Experiência desktop

- [x] Identidade visual oficial do Seven Mail
- [x] Favicon e ícones nativos derivados da identidade oficial
- [x] Tela de inicialização animada com bootstrap local-first real

- [x] Windows
- [x] Linux
- [x] macOS
- [x] Bandeja do sistema
- [x] Badge de mensagens não lidas
- [x] Notificações nativas
- [x] Protocolo mailto:
- [x] Definir como cliente padrão
- [x] Abrir arquivos EML
- [x] Abrir arquivos MSG quando suportado
- [x] Abrir arquivos OFT quando suportado
- [x] Abrir arquivos ICS
- [x] Arrastar arquivos para composição
- [x] Arrastar anexos para área de trabalho
- [x] Arrastar anexos para outros aplicativos
- [x] Múltiplas janelas
- [x] Atualizações automáticas (verificação automática e instalação guiada com SHA-256)

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

- [x] Estrutura inicial do projeto
- [x] Sistema de contas
- [x] Armazenamento local
- [x] IMAP
- [x] SMTP
- [x] OAuth 2.0 + PKCE
- [x] Descoberta automática de contas
- [x] Primeira sincronização
- [x] Caixa de entrada
- [x] Leitura de mensagem
- [x] Envio de mensagem

## 0.2.0 — Cliente de e-mail

- [x] Pastas
- [x] Rascunhos
- [x] Anexos
- [x] Assinaturas
- [x] Pesquisa
- [x] Categorias
- [x] Favoritos
- [x] Spam
- [x] Regras
- [x] Caixa prioritária
- [x] Ações rápidas
- [x] Limpeza automática
- [x] Respostas automáticas

## 0.3.0 — Múltiplas contas

- [x] Caixa unificada
- [x] OAuth
- [x] Gmail
- [x] Yahoo
- [x] iCloud
- [x] Microsoft 365
- [x] Configuração manual
- [x] Perfis
- [x] Caixas compartilhadas
- [x] Delegação
- [x] Enviar como / em nome de
- [x] Sincronização independente

## 0.4.0 — Offline

- [x] Cache local
- [x] Caixa de saída
- [x] Pesquisa offline
- [x] Sincronização incremental
- [x] Resolução de conflitos

## 0.5.0 — Calendário

- [x] CalDAV e/ou API do provedor
- [x] Calendários
- [x] Eventos
- [x] Recorrência
- [x] Convites
- [x] Assistente de agendamento
- [x] Livre/ocupado
- [x] Compartilhamento e delegação
- [x] ICS
- [x] Lembretes

## 0.6.0 — Contatos

- [x] CardDAV e/ou API do provedor
- [x] Pessoas
- [x] Favoritos
- [x] Categorias
- [x] Grupos
- [x] Diretório corporativo / LDAP
- [x] CSV
- [x] vCard

## 0.7.0 — Tarefas

- [x] Listas
- [x] Prioridades
- [x] Lembretes
- [x] Recorrência
- [x] Integração com e-mails
- [x] Notas

## 0.8.0 — Produtividade

- [x] Agendamento de envio
- [x] Desfazer envio
- [x] Modelos
- [x] Pastas de pesquisa
- [x] Pesquisa avançada
- [x] Regras avançadas
- [x] Formatação condicional
- [x] Reenvio e recuperação de mensagens quando suportados
- [x] Leitura em voz alta
- [x] Leitura imersiva
- [x] Mala direta

## 0.9.0 — Segurança e migração

- [x] S/MIME
- [x] Assinaturas digitais
- [x] Importação
- [x] Exportação
- [x] Backup
- [x] Criptografia local
- [x] Regras e configurações importáveis/exportáveis
- [x] Políticas corporativas quando suportadas pelo provedor (retenção, sensibilidade, direitos e restrições via adapter nativo)

## 1.0.0 — Stable

- [x] Windows
- [x] Linux
- [x] macOS
- [x] Atualizador automático
- [x] Instaladores
- [x] Migração completa
- [x] Testes de carga
- [x] Testes de segurança
- [x] Testes de sincronização
- [x] Documentação completa
- [x] Caixas compartilhadas e delegação validadas
- [x] Calendário/contatos sincronizados por provedor
- [x] Compatibilidade EML/ICS validada

---

# Extensões e integrações

- [x] Arquitetura de extensões
- [x] Integrações de reunião online
- [x] Integrações com armazenamento em nuvem
- [x] Ações externas seguras
- [x] Permissões isoladas por extensão
- [x] Ativar/desativar extensões individualmente

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

## Documentação

- [Índice da documentação](docs/README.md)
- [Guia do usuário](docs/USER_GUIDE.md)
- [Arquitetura](docs/ARCHITECTURE.md)
- [Segurança](docs/SECURITY.md)
- [Migração](docs/MIGRATION.md)
- [Integrações corporativas](docs/ENTERPRISE.md)
- [Releases e distribuição](docs/RELEASES.md)

---

## Autor

Desenvolvido por [gabriell211](https://github.com/gabriell211).

---

<p align="center">
  <strong>Seven Mail</strong><br />
  Mail. Calendar. People. Tasks.
</p>
