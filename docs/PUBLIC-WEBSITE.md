# Publicação do site Seven Mail

As páginas públicas estão em `docs/index.html`, `docs/privacy.html` e `docs/terms.html`. A publicação não depende do aplicativo desktop.

1. Após aprovação e merge do PR, acesse https://github.com/gabriell211/Seven-Mail/settings/pages.
2. Em Build and deployment, selecione Deploy from a branch, branch main e pasta /docs; salve.
3. Confirme que os três links retornam HTTP 200 sem autenticação:
   - https://gabriell211.github.io/Seven-Mail/
   - https://gabriell211.github.io/Seven-Mail/privacy.html
   - https://gabriell211.github.io/Seven-Mail/terms.html
4. Verifique a propriedade do domínio no Search Console (propriedade de prefixo de URL, com o arquivo HTML ou meta tag fornecido pelo Google). Não invente tokens de verificação.
5. Cadastre os endereços no Google Auth Platform, revise a configuração da marca e envie para verificação.

A política precisa ser revisada pelo responsável do projeto antes de publicação/solicitação ao Google, especialmente identidade do controlador, contato, retenção/exclusão remota, processamento internacional, integração Gemini e regras de Uso Limitado para transferências de dados Google. As páginas não comprovam conformidade técnica nem aprovação OAuth. Verificar se fluxos existentes impedem transferências incompatíveis com as políticas antes de solicitar aprovação. Não usar a modalidade Gemini inadequada para dados Google protegidos.

Referências:
- https://support.google.com/cloud/answer/13464321
- https://developers.google.com/terms/api-services-user-data-policy
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
