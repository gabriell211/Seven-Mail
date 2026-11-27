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
