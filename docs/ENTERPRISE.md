# Integrações corporativas

## Protocolos

O Seven Mail suporta IMAP/SMTP, POP3, CalDAV, CardDAV e LDAP. Recursos proprietários são habilitados apenas quando o provedor e a autenticação oferecem as capacidades necessárias.

## Contas compartilhadas e delegação

Perfis de conta podem representar caixas compartilhadas, permissões de leitura/envio, envio em nome de, calendário compartilhado e delegados. O aplicativo respeita as permissões declaradas pela conta.

## Diretório

LDAP pode alimentar o diretório de destinatários e contatos. Credenciais seguem o mesmo modelo seguro das demais conexões.

## Calendário

CalDAV suporta leitura e escrita de eventos. O workspace local mantém permissões, compartilhamento, delegados, respostas de participantes e recursos.

## Políticas do provedor

Retenção, rótulos de sensibilidade, recall e restrições de encaminhamento/cópia dependem de APIs proprietárias do servidor. O Seven Mail não simula sucesso quando o servidor não oferece a operação.

## S/MIME / PKI

Empresas podem distribuir certificados X.509 para destinatários e identidades PKCS#12 por conta. Para ambientes com CA interna, a gestão da cadeia e políticas de confiança continua sendo responsabilidade da PKI corporativa.

## Neon

A sincronização opcional do workspace usa Neon. Credenciais de e-mail permanecem fora do banco cloud.
