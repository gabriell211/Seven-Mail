# Nuvem Seven — conexões externas

A sincronização existente mantém o mesmo isolamento e consentimento. O nome comercial na interface é Nuvem Seven; nomes de infraestrutura e variáveis de build são internos. As conexões externas são separadas da conta Nuvem Seven e das credenciais de e-mail e Gemini. Este PR não migra dados nem implementa backup/restauração.

## Google Drive
- Cliente desktop registrado do Seven Mail por padrão; habilitar Drive API no projeto e conceder `https://www.googleapis.com/auth/drive.appdata`, openid e email. Não solicita acesso a todos os arquivos.
- OAuth por navegador, loopback IPv4, state, PKCE S256, cofre local e renovação sob demanda. Verifica listagem limitada a appDataFolder antes de armazenar autorização.
- https://developers.google.com/workspace/drive/api/guides/appdata

## OneDrive
- Registrar cliente público Microsoft Entra para contas pessoais, plataforma Mobile and desktop applications e redirect loopback `http://127.0.0.1` (registro conforme documentação; porta dinâmica). Configurar `SEVEN_MAIL_ONEDRIVE_CLIENT_ID` como variável pública de release ou informar Client ID na tela.
- Escopo delegado Files.ReadWrite.AppFolder e offline_access; verifica /me/drive/special/approot. Não solicita escopo geral de arquivos ou perfil.
- https://learn.microsoft.com/graph/onedrive-sharepoint-appfolder

## TeraBox
- https://www.terabox.com/integrations/docs/portuguese
- Solicitar credenciais próprias de parceiro. O modo de dispositivo usa QR e troca assinada no servidor com client_secret e private_secret. Esses segredos não pertencem ao cliente desktop. Opção visível mas desabilitada até existir backend e homologação oficiais.

## Próximas etapas
Homologar consentimento real Google e Microsoft, renovar e desconectar; implementar snapshots criptografados, versão de esquema, restauração confirmada, isolamento de proprietário e tratamento de conflitos. Não enviar mensagens, anexos, senhas ou tokens a armazenamento externo até autorização específica. Não apresentar conexão como sincronização ativa.

## Marcas dos provedores

Arquivos oficiais para distribuição local, sem consultas a CDNs durante a utilização:
- Google Drive: https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-64dp/logo_drive_2026_color_2x_web_64dp.png (https://developers.google.com/workspace/drive/api/guides/branding).
- OneDrive: https://www.microsoft.com/content/dam/microsoft/bade/images/icons/en-us/m365-app-icons-fy26/OneDrive-Icon-FY26.svg.
- TeraBox: https://s5.teraboxcdn.com/common-static/favicon.ico (favicon da página oficial).
As marcas identificam seus respectivos serviços e não representam endosso do Seven Mail. O layout apenas redimensiona preservando a proporção. Google Drive e OneDrive estão versionados em `public/providers/`; o TeraBox será adicionado após validação do arquivo oficial (inclusive quando servido com compressão HTTP). A tarefa isolada de CI valida os formatos antes de incorporar os arquivos. Os builds e a execução não consultam CDNs para exibir marcas.
