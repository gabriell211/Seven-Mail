# Documentação do Seven Mail

Este diretório reúne a documentação funcional e técnica usada pela versão estável do Seven Mail.

## Guias

- [Guia do usuário](USER_GUIDE.md) — contas, e-mail, composição, calendário, contatos, tarefas, notas, offline, backup e atalhos.
- [Arquitetura](ARCHITECTURE.md) — separação entre apresentação, domínio, protocolos, sincronização, armazenamento e cloud.
- [Segurança](SECURITY.md) — Keyring, criptografia local, OAuth, S/MIME, conteúdo remoto, anexos e limpeza segura.
- [Migração](MIGRATION.md) — EML, MSG, OFT, MBOX, PST, ICS, CSV, vCard, perfis e backup.
- [Integrações corporativas](ENTERPRISE.md) — APIs nativas, caixas compartilhadas, delegação, LDAP, políticas, sensibilidade e retenção.
- [Releases](RELEASES.md) — versionamento, validação, instaladores e atualizador.

## Princípio de compatibilidade

Recursos condicionais nunca devem fingir sucesso. Recall, rótulos, retenção, direitos de uso, push e outras funções proprietárias são ativados somente quando a conta, o tenant, o protocolo ou a API do provedor oferecem a capacidade.

## Dados e credenciais

Backups e migrações podem transportar workspace, regras, perfis, configurações e conteúdo suportado. Senhas, tokens privados e segredos permanecem protegidos pelo Keyring/Credential Manager e devem ser reautorizados no novo dispositivo quando necessário.
