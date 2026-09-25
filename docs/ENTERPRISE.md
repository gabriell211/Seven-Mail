# Integrações corporativas

## Protocolos

O Seven Mail suporta IMAP/SMTP, POP3, CalDAV, CardDAV e LDAP. Recursos proprietários são habilitados apenas quando o provedor e a autenticação oferecem as capacidades necessárias.

## Contas compartilhadas e delegação

Perfis de conta podem representar caixas compartilhadas, permissões de leitura/envio, envio em nome de, calendário compartilhado e delegados. O aplicativo respeita as permissões declaradas pela conta.

## Diretório

LDAP pode alimentar o diretório de destinatários e contatos. Credenciais seguem o mesmo modelo seguro das demais conexões.

## Calendário

CalDAV suporta leitura e escrita de eventos. O workspace local mantém permissões, compartilhamento, delegados, respostas de participantes e recursos.

## APIs nativas do provedor

O módulo de capacidades separa recursos padrão (IMAP/SMTP/DAV/LDAP) de recursos proprietários.

Para contas Microsoft OAuth, quando o tenant e os scopes permitem, o Seven Mail usa Microsoft Graph para:

- consultar rótulos de sensibilidade;
- consultar rótulos/políticas de retenção;
- consultar direitos efetivos de um rótulo;
- aplicar restrições de encaminhamento/cópia na interface;
- solicitar recall de uma mensagem enviada.

O recall continua sujeito às regras do serviço e do destinatário. Um pedido aceito pela API não garante que todos os destinatários tiveram a mensagem recolhida.

## Rótulos de sensibilidade e direitos

Ao abrir uma mensagem com metadados de sensibilidade reconhecidos, o Seven Mail consulta direitos do rótulo quando a conta possui capacidade nativa. Se o direito de encaminhar ou copiar não estiver presente, as ações correspondentes são desabilitadas.

## Retenção

As políticas de retenção são lidas do catálogo corporativo quando o tenant concede a permissão necessária. O Seven Mail não inventa políticas locais para representar uma retenção que deveria ser imposta no servidor.

## Reações

O Seven Mail:

- respeita `x-ms-reactions: disallow` quando presente;
- permite bloquear reações no compositor para provedores/clientes compatíveis;
- envia reações por MIME compatível com clientes que suportam o formato de reação publicado pelo provedor;
- mantém fallback textual/HTML para clientes que não renderizam reação nativamente.

## Push

Contas IMAP usam IDLE para detectar alterações em tempo real quando o servidor oferece suporte. POP3 usa sincronização periódica.

## S/MIME / PKI

Empresas podem distribuir certificados X.509 para destinatários e identidades PKCS#12 por conta. Para ambientes com CA interna, a gestão da cadeia e políticas de confiança continua sendo responsabilidade da PKI corporativa.

## Neon

A sincronização opcional do workspace usa Neon. Credenciais de e-mail permanecem fora do banco cloud.
