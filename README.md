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

> **Status:** Em desenvolvimento ativo. A linha desktop 0.4.x já possui cliente local-first funcional para Windows e Linux, com IMAP/SMTP, múltiplas contas, caixa unificada, composição, fila offline, regras, pesquisa avançada, calendário local, contatos, tarefas, notas e sincronização opcional com Neon.

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
- [ ] Formatação condicional da lista de mensagens
- [ ] Cabeçalhos recolhíveis na lista
- [ ] Ações rápidas configuráveis na lista
- [x] Painel de leitura configurável
- [x] Abrir mensagem em nova janela
- [x] Abrir múltiplas mensagens simultaneamente

### Mensagens

- [x] Enviar e-mail
- [x] Responder
- [x] Responder a todos
- [x] Encaminhar
- [ ] Encaminhar como anexo
- [x] Editar rascunhos
- [x] Salvar rascunhos automaticamente
- [x] Excluir mensagens
- [ ] Restaurar mensagens excluídas
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
- [ ] Ignorar conversa
- [x] Silenciar conversa
- [ ] Reenviar mensagem
- [ ] Recuperar/recolher mensagem enviada quando suportado pelo provedor
- [ ] Reações em mensagens quando suportadas
- [ ] Arrastar mensagens entre pastas
- [ ] Arrastar mensagens entre contas quando suportado
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
- [ ] Imagens inline
- [x] Emojis
- [x] Campo De selecionável
- [x] Envio usando aliases
- [x] Corretor ortográfico
- [ ] Correção automática
- [ ] Capitalização automática
- [ ] Dicionários por idioma
- [ ] Ditado por voz quando disponível no sistema
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
- [ ] Modelos baseados em arquivo quando suportado
- [x] Reutilização de blocos de conteúdo
- [ ] Pré-visualização de links
- [x] Verificação de destinatários
- [x] Aviso de anexo esquecido
- [x] Aviso de assunto vazio

### Anexos

- [x] Upload por botão
- [x] Arrastar e soltar
- [x] Download
- [x] Download de todos
- [ ] Pré-visualização
- [ ] Imagens
- [ ] PDFs
- [ ] Documentos
- [ ] Planilhas
- [ ] Arquivos compactados
- [x] Limite configurável
- [ ] Indicador de progresso
- [ ] Cancelamento de upload
- [x] Bloqueio de extensões perigosas
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
- [x] Abrir e salvar EML
- [ ] Abrir e salvar MSG quando tecnicamente viável
- [ ] Abrir e reutilizar modelos OFT quando tecnicamente viável
- [ ] Importar e exportar regras
- [x] Favoritar categorias
- [ ] Ações por gesto quando suportadas pela plataforma

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
- [ ] Subpastas
- [x] Renomear pasta
- [x] Excluir pasta
- [x] Reordenar pastas
- [x] Favoritar pastas
- [x] Contadores por pasta
- [x] Ir diretamente para uma pasta
- [ ] Pastas compartilhadas
- [ ] Arquivo de caixa compartilhada

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
- [ ] Pesquisa em caixas compartilhadas
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
- [ ] Mencionando o usuário
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
- [ ] Redirecionar quando suportado
- [x] Parar processamento de outras regras

---

## Spam e remetentes

- [x] Filtro de spam
- [x] Lista de remetentes bloqueados
- [x] Lista de remetentes confiáveis
- [x] Bloqueio por domínio
- [x] Liberação de remetente
- [x] Denúncia de phishing
- [ ] Visualização segura de links
- [ ] Bloqueio de conteúdo remoto
- [ ] Permissão de imagens por remetente

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
- [ ] Perfis separados de e-mail
- [ ] Perfis com conjuntos diferentes de contas e configurações
- [x] Aliases por conta

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

- [x] IMAP
- [x] SMTP
- [ ] POP3
- [ ] OAuth 2.0
- [ ] Authorization Code + PKCE
- [ ] Renovação segura de tokens
- [x] Descoberta automática de configuração
- [ ] CalDAV
- [ ] CardDAV
- [ ] APIs nativas de provedores quando necessárias
- [x] Autenticação por senha quando suportada
- [x] Gmail
- [x] Yahoo
- [x] iCloud Mail
- [x] Microsoft 365
- [x] Conta Microsoft
- [x] Servidores corporativos
- [x] Servidores personalizados
- [ ] Diretórios LDAP quando disponíveis

## Configuração avançada

- [x] Configuração automática
- [x] Configuração manual
- [x] Porta IMAP
- [ ] Porta POP
- [x] Porta SMTP
- [x] SSL/TLS
- [x] STARTTLS
- [ ] Timeout configurável
- [x] Validação de certificado
- [x] Teste de conexão

---

# Calendário

## Calendários

- [ ] Múltiplos calendários
- [ ] Calendários por conta
- [ ] Calendários compartilhados
- [x] Calendários locais
- [ ] Mostrar/ocultar calendários
- [x] Cores personalizadas

## Visualizações

- [x] Dia
- [x] Semana
- [ ] Semana útil
- [x] Mês
- [x] Agenda
- [ ] Visualização de 3 dias
- [ ] Calendários lado a lado
- [x] Hoje

## Eventos

- [x] Criar evento
- [x] Editar evento
- [x] Excluir evento
- [ ] Duplicar evento
- [ ] Arrastar evento
- [ ] Redimensionar evento
- [x] Local
- [x] Descrição
- [x] Participantes
- [ ] Participantes obrigatórios
- [ ] Participantes opcionais
- [ ] Salas e recursos
- [x] Evento de dia inteiro
- [ ] Evento privado
- [x] Lembretes
- [ ] Recorrência
- [ ] Exceções de recorrência
- [ ] Editar somente esta ocorrência
- [ ] Editar esta e as próximas ocorrências
- [ ] Copiar, recortar e colar eventos
- [x] Anexos
- [x] Categorias

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

- [x] Importar ICS
- [x] Exportar ICS
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

- [x] Criar contato
- [x] Editar contato
- [x] Excluir contato
- [ ] Foto
- [x] Nome
- [ ] Sobrenome
- [ ] Apelido
- [x] Empresa
- [x] Cargo
- [x] E-mails
- [x] Telefones
- [ ] Endereços
- [ ] Datas importantes
- [x] Observações

## Organização

- [x] Contatos favoritos
- [ ] Categorias
- [ ] Grupos
- [ ] Listas de contatos
- [ ] Catálogo global de endereços
- [ ] Diretório corporativo
- [ ] Consulta LDAP
- [ ] Grupos de distribuição
- [ ] Destinatários sugeridos
- [x] Pesquisa
- [ ] Mesclar duplicados
- [ ] Detecção de duplicados
- [ ] Edição em massa
- [ ] Exclusão em massa

## Importação e exportação

- [x] CSV
- [x] vCard
- [x] Backup de contatos

## Compartilhamento

- [ ] Contatos compartilhados quando suportados pelo provedor
- [ ] Listas compartilhadas
- [ ] Diretórios corporativos somente leitura

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
- [ ] Recorrência
- [ ] Categorias
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
- [ ] E-mails sinalizados como tarefas

---

# Notas

- [x] Criar nota
- [x] Editar nota
- [x] Excluir nota
- [x] Pesquisa em notas
- [x] Categorias
- [x] Fixar notas
- [x] Armazenamento local
- [ ] Sincronização quando suportada pelo provedor

---

# Offline

O Seven Mail deverá continuar funcional mesmo sem conexão.

- [x] Cache local de mensagens
- [ ] Cache de anexos selecionados
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
- [ ] Resolução de conflitos
- [ ] Sincronização incremental
- [ ] Configuração do período armazenado localmente

---

# Notificações

- [x] Nova mensagem
- [x] Mensagem importante
- [x] Lembrete de evento
- [x] Lembrete de tarefa
- [x] Configuração por conta
- [x] Configuração por pasta
- [ ] Silenciar conta
- [x] Silenciar conversa
- [ ] Horário silencioso
- [ ] Ações rápidas pela notificação

---

# Importação e exportação

## Importação

- [x] Mensagens
- [x] Pastas
- [x] Contatos
- [x] Calendários
- [ ] Tarefas
- [x] Arquivos EML
- [ ] Arquivos MSG quando tecnicamente viável
- [ ] Arquivos OFT quando tecnicamente viável
- [ ] Arquivos MBOX
- [ ] Arquivos PST quando tecnicamente disponível
- [x] CSV
- [x] ICS
- [x] vCard
- [x] Configurações do aplicativo
- [x] Regras
- [ ] Perfis

## Exportação

- [x] EML
- [ ] MBOX
- [x] CSV
- [x] ICS
- [x] vCard
- [x] Regras
- [x] Configurações
- [ ] Perfis
- [ ] Backup completo do perfil
- [ ] Backup criptografado

---

# Segurança e privacidade

- [x] Credenciais armazenadas com segurança
- [x] Keychain/Keyring do sistema operacional
- [ ] OAuth 2.0
- [x] TLS
- [x] Validação de certificado
- [ ] Proteção contra conteúdo remoto
- [ ] Proteção contra rastreamento por pixels
- [x] Sanitização de HTML
- [x] Proteção contra XSS
- [ ] Bloqueio de URLs perigosas
- [ ] Avisos para links suspeitos
- [ ] Aviso de remetente externo
- [x] Bloqueio de anexos perigosos
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

- [x] Tema claro
- [x] Tema escuro
- [x] Seguir sistema
- [x] Densidade confortável
- [x] Densidade compacta
- [ ] Tamanho da fonte
- [ ] Personalização da lista de mensagens
- [x] Painel de leitura à direita
- [x] Painel de leitura abaixo
- [x] Painel de leitura desativado
- [ ] Personalização do menu lateral
- [ ] Personalização de ações rápidas
- [ ] Personalização do painel de pastas
- [ ] Mostrar/ocultar fotos dos remetentes

## Comportamento

- [x] Abrir próxima mensagem após excluir
- [x] Marcar como lida automaticamente
- [x] Tempo para marcar como lida
- [x] Confirmação antes de excluir
- [x] Confirmação antes de enviar
- [ ] Respostas automáticas
- [ ] Encaminhamento
- [x] Atraso padrão de envio
- [ ] Comportamento do botão fechar
- [x] Minimizar para bandeja
- [x] Iniciar com o sistema

## Idioma e região

- [ ] Múltiplos idiomas
- [ ] Formato de data
- [ ] Formato de hora
- [ ] Primeiro dia da semana
- [ ] Fuso horário
- [x] Verificação ortográfica
- [ ] Autocorreção
- [ ] Capitalização automática
- [ ] Dicionários personalizados

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
- [x] Carregamento incremental
- [ ] Virtualização da lista de mensagens
- [x] Cache inteligente
- [ ] Sincronização incremental
- [ ] Paginação
- [ ] Indexação local
- [ ] Busca rápida
- [x] Processamento de mensagens em background
- [ ] Limite de concorrência
- [ ] Retry com backoff
- [ ] Economia de memória
- [ ] Economia de bateria
- [ ] Suporte a caixas com grande volume de mensagens

---

# Sincronização

- [x] Sincronização em background
- [x] Sincronização por intervalo
- [ ] Push quando suportado
- [x] Sincronização manual
- [x] Sincronização por pasta
- [ ] Estado por conta
- [x] Indicador de erros
- [x] Retentativas automáticas
- [x] Reconexão
- [ ] Detecção de alterações remotas
- [ ] Resolução de conflitos

---

# Experiência desktop

- [x] Identidade visual oficial do Seven Mail
- [x] Favicon e ícones nativos derivados da identidade oficial
- [x] Tela de inicialização animada com bootstrap local-first real

- [x] Windows
- [x] Linux
- [ ] macOS
- [x] Bandeja do sistema
- [ ] Badge de mensagens não lidas
- [x] Notificações nativas
- [ ] Protocolo mailto:
- [ ] Definir como cliente padrão
- [x] Abrir arquivos EML
- [ ] Abrir arquivos MSG quando suportado
- [ ] Abrir arquivos OFT quando suportado
- [ ] Abrir arquivos ICS
- [x] Arrastar arquivos para composição
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

- [x] Estrutura inicial do projeto
- [x] Sistema de contas
- [x] Armazenamento local
- [x] IMAP
- [x] SMTP
- [ ] OAuth 2.0 + PKCE
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
- [ ] Caixa prioritária
- [ ] Ações rápidas
- [ ] Limpeza automática
- [ ] Respostas automáticas

## 0.3.0 — Múltiplas contas

- [x] Caixa unificada
- [ ] OAuth
- [x] Gmail
- [x] Yahoo
- [ ] iCloud
- [x] Microsoft 365
- [x] Configuração manual
- [ ] Perfis
- [ ] Caixas compartilhadas
- [ ] Delegação
- [ ] Enviar como / em nome de
- [x] Sincronização independente

## 0.4.0 — Offline

- [x] Cache local
- [x] Caixa de saída
- [x] Pesquisa offline
- [ ] Sincronização incremental
- [ ] Resolução de conflitos

## 0.5.0 — Calendário

- [ ] CalDAV e/ou API do provedor
- [x] Calendários
- [ ] Eventos
- [ ] Recorrência
- [ ] Convites
- [ ] Assistente de agendamento
- [ ] Livre/ocupado
- [ ] Compartilhamento e delegação
- [x] ICS
- [x] Lembretes

## 0.6.0 — Contatos

- [ ] CardDAV e/ou API do provedor
- [ ] Pessoas
- [x] Favoritos
- [x] Categorias
- [ ] Grupos
- [ ] Diretório corporativo / LDAP
- [x] CSV
- [x] vCard

## 0.7.0 — Tarefas

- [x] Listas
- [x] Prioridades
- [x] Lembretes
- [ ] Recorrência
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
- [ ] Leitura em voz alta
- [ ] Leitura imersiva
- [ ] Mala direta

## 0.9.0 — Segurança e migração

- [ ] S/MIME
- [ ] Assinaturas digitais
- [x] Importação
- [x] Exportação
- [x] Backup
- [ ] Criptografia local
- [x] Regras e configurações importáveis/exportáveis
- [ ] Políticas corporativas quando suportadas pelo provedor

## 1.0.0 — Stable

- [x] Windows
- [x] Linux
- [ ] macOS
- [ ] Atualizador automático
- [x] Instaladores
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
