# Seven Mail — Guia do usuário

## Primeiros passos

O Seven Mail é um cliente desktop local-first. Adicione uma conta em **Configurações > Contas**. Para provedores conhecidos, o aplicativo preenche servidores automaticamente; contas personalizadas aceitam IMAP/SMTP, POP3, CalDAV, CardDAV e LDAP quando configurados.

Credenciais e tokens ficam no Keyring/Credential Manager do sistema. Mensagens, filas e workspace ficam no diretório local do aplicativo e são criptografados em repouso.

## E-mail

- Caixa por conta e caixa unificada.
- Pastas IMAP, subpastas, favoritos, ordenação, conversas e caixa prioritária.
- Categorias, sinalizadores, mensagens fixadas, pesquisa avançada e pesquisas salvas.
- Responder, responder a todos, encaminhar, redirecionar, reenviar e encaminhar como anexo.
- Arraste mensagens para outra conta para transferi-las via IMAP APPEND quando o destino suportar.
- Anexos podem ser salvos, mantidos offline, visualizados, arrastados para outros aplicativos e reutilizados em outra mensagem ou conta.
- Importação de EML/MSG/PST e leitura de OFT como modelo.
- Exportação de EML e PST.
- Reações por emoji são enviadas em formato MIME compatível quando permitido pela mensagem/provedor.
- Mensagens enviadas por conta Microsoft OAuth podem solicitar recall quando o Microsoft Graph e a organização oferecem a operação.
- Ações rápidas de novas mensagens ficam disponíveis no app para abrir, marcar como lida ou arquivar.
- Envio agendado e desfazer envio usam a fila local durável.

## Compositor

O compositor oferece HTML/texto simples, formatação, links, imagens inline, tabelas, emoji, ditado, assinatura por conta, modelos, blocos de conteúdo, prioridade, recibos, mala direta e S/MIME.

S/MIME exige uma identidade PKCS#12 na conta. Para criptografar, importe também o certificado X.509 de cada destinatário em **Configurações > S/MIME**.

Quando suportado pelo servidor, o compositor também pode marcar a mensagem para bloquear reações.

## Calendário

Visualizações Dia, 3 dias, Semana, Semana útil, Mês e Agenda. Há recorrência, exceções, recursos, fusos horários, disponibilidade, compartilhamento/delegação, convites e respostas, lembretes e importação/exportação ICS.

## Pessoas

Contatos locais e CardDAV, múltiplos e-mails/telefones/endereços, grupos/listas, favoritos, compartilhamento e importação/exportação CSV/vCard.

## Tarefas e notas

Tarefas suportam listas, prioridades, início, vencimento, lembretes, filtros Hoje/Atrasadas/Próximas e vínculo com e-mail. Notas podem ser pesquisadas, fixadas e coloridas.

## Contas corporativas

Em contas Microsoft OAuth, **Configurações > Políticas corporativas** consulta capacidades nativas disponíveis no tenant:

- catálogo de rótulos de sensibilidade;
- políticas de retenção;
- direitos de uso de um rótulo;
- restrições de encaminhamento/cópia;
- recall de mensagem enviada quando o provedor permitir.

Se a API ou a permissão OAuth não estiver disponível, o Seven Mail mostra o erro do provedor em vez de simular sucesso.

## Offline e push

Leitura, pesquisa, rascunhos, respostas, encaminhamentos, fila de saída, calendário, contatos e tarefas continuam locais. Ao voltar a ficar online, operações pendentes são sincronizadas.

Contas IMAP usam IDLE/push quando o servidor suporta. POP3 continua por sincronização periódica.

## Backup e migração

**Configurações > Dados locais** permite:

- exportar/restaurar backup JSON;
- criar backup JSON criptografado;
- importar PST para o cache local;
- exportar mensagens locais para PST;
- limpar cache;
- executar limpeza segura de dados locais.

O backup inclui workspace, preferências e metadados de contas; senhas de e-mail permanecem no Keyring e não são exportadas.

## Atualizações

Por padrão, o Seven Mail verifica a release oficial do GitHub depois da inicialização. Quando há uma versão nova:

1. seleciona o instalador compatível com a plataforma;
2. baixa para a pasta local de atualizações;
3. compara o SHA-256 calculado com o digest publicado pelo GitHub Release;
4. descarta o arquivo se a verificação falhar;
5. abre o instalador somente após validação.

A verificação automática pode ser desativada em **Configurações > Desktop**, e também existe **Verificar agora**.

## Atalhos

Os atalhos padrão incluem Ctrl+N, Ctrl+K, R, Shift+R, F, E, U, Delete, setas para navegar e Alt+1..4 para módulos. Eles podem ser personalizados nas configurações.

## Idiomas

A interface oferece Português (Brasil), English e Español.
