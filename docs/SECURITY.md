# Segurança do Seven Mail

## Modelo local-first

O Seven Mail mantém dados operacionais no dispositivo. No Windows, a raiz é `%APPDATA%\Seven Mail`. No Linux e macOS são usados os diretórios nativos de dados do usuário.

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
- Restrições de sensibilidade retornadas pelo provedor podem bloquear encaminhamento/cópia na interface.
- A política `x-ms-reactions: disallow` é respeitada na leitura.

## S/MIME

A identidade S/MIME é importada em PKCS#12 (P12/PFX). O arquivo é armazenado criptografado e sua senha fica no Keyring.

O envio pode:

- assinar com CMS/PKCS#7;
- criptografar com AES-256-CBC dentro de CMS para certificados X.509 dos destinatários.

A leitura inspeciona envelopes S/MIME, tenta descriptografar com a identidade da conta e verifica a integridade criptográfica da assinatura.

A verificação de integridade não substitui validação corporativa completa da cadeia de confiança/PKI. Organizações com CA interna continuam responsáveis por políticas de confiança e distribuição de certificados.

## Atualizações

O atualizador consulta somente a release oficial do repositório Seven Mail.

Antes de abrir o instalador:

1. o download usa HTTPS;
2. o tamanho é limitado;
3. o SHA-256 é calculado durante o download;
4. o valor é comparado ao digest `sha256:` publicado no asset do GitHub Release;
5. arquivos com digest ausente/inválido ou hash divergente são descartados.

O instalador nunca é aberto após falha de integridade.

## Limpeza

A limpeza segura remove cache, workspace e filas locais. Remover uma conta também limpa operações e credenciais associadas conforme os fluxos do aplicativo.

## Políticas corporativas

APIs nativas são usadas somente quando a conta/provedor oferece a capacidade e o OAuth concedeu as permissões necessárias. Erros de autorização ou capacidade são mostrados ao usuário; o Seven Mail não simula recall, retenção ou proteção corporativa.

## Relato de vulnerabilidade

Não publique segredos, credenciais ou mensagens reais em issues públicas. Relatos devem conter apenas passos mínimos de reprodução e dados sintéticos.
