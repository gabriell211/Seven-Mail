# Segurança do Seven Mail

## Modelo local-first

O Seven Mail mantém dados operacionais no dispositivo. No Windows, a raiz é `%APPDATA%\Seven Mail`. No Linux é usado o diretório de dados local do usuário.

## Credenciais

- Senhas de e-mail, tokens OAuth, PIN do bloqueio, chave de criptografia local e senha de identidade S/MIME usam Keyring/Credential Manager.
- Credenciais nunca são incluídas no backup do workspace.
- O cache e os arquivos internos usam AES-256-GCM por meio de uma chave aleatória armazenada no Keyring.

## Transporte

IMAP, SMTP, POP3, CalDAV, CardDAV e LDAP usam TLS/STARTTLS conforme configuração. Certificados TLS inválidos não são aceitos silenciosamente.

## Conteúdo de mensagens

- HTML recebido é sanitizado.
- Conteúdo remoto pode ser bloqueado.
- Links suspeitos podem gerar aviso.
- Extensões perigosas de anexos são bloqueadas no envio.
- SPF, DKIM e DMARC reportados pelo servidor são mostrados na aba Segurança.

## S/MIME

A identidade S/MIME é importada em PKCS#12 (P12/PFX). O arquivo é armazenado criptografado e sua senha fica no Keyring.

O envio pode:
- assinar com CMS/PKCS#7;
- criptografar com AES-256-CBC dentro de CMS para certificados X.509 dos destinatários.

A leitura inspeciona envelopes S/MIME, tenta descriptografar com a identidade da conta e verifica a integridade criptográfica da assinatura. A verificação de integridade não substitui validação corporativa completa da cadeia de confiança/PKI.

## Limpeza

A limpeza segura remove cache, workspace e filas locais. Remover uma conta também limpa operações e credenciais associadas conforme os fluxos do aplicativo.

## Relato de vulnerabilidade

Não publique segredos, credenciais ou mensagens reais em issues públicas. Relatos devem conter apenas passos mínimos de reprodução e dados sintéticos.
