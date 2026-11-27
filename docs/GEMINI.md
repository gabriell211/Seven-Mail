# Google Gemini (integração opcional)

O backend Rust utiliza a API REST Gemini via HTTPS; não há runtime adicional no instalador. A chave é fornecida pelo usuário no painel, validada por consulta de metadados do modelo e armazenada no cofre nativo. Não é login Google OAuth nem acesso à assinatura pessoal Gemini.

1. Obtenha a chave em https://aistudio.google.com/apikey.
2. Informe a chave e o modelo no painel e clique em Validar e salvar.
3. Selecione uma conta e envie uma pergunta. A sessão de leitura é aberta automaticamente, sem confirmação adicional.

## Segurança e privacidade

- Leitura liberada após a configuração inicial da chave, sem prazo de 30 minutos nem aprovação a cada leitura. Sessões internas isolam a conta selecionada; fechar o painel, trocar de conta, desconectar ou bloquear o aplicativo invalida a sessão. O texto é enviado ao Google somente ao solicitar uma consulta.
- Até 20 mensagens recentes ou uma selecionada na busca do cache local; somente texto limitado, sem anexos ou HTML.
- O modelo não recebe ferramentas de sistema ou mutações de e-mail. Rascunhos exigem aprovação única e expiram em cinco minutos. Enviar, mover, excluir e alterar configurações continuam indisponíveis ao modelo.
- A chave nunca é devolvida ao frontend, nem incluída na URL. O backend não segue redirecionamentos e não registra o corpo das respostas de erro.
- A API gratuita não deve receber dados pessoais, sensíveis ou confidenciais. Use projeto faturado autorizado pela organização e revise https://ai.google.dev/gemini-api/terms. A funcionalidade destina-se ao uso profissional por adultos em regiões suportadas.

## Homologação pendente

Validar geração real, compatibilidade do modelo escolhido e cotas com chave de teste autorizada; executar CI e testar o cofre no Windows, Linux e macOS. Streaming e persistência da escolha do modelo ainda não implementados. Não considerar homologado apenas pela validação de metadados.
