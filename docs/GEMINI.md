# Google Gemini (integração opcional)

O backend Rust utiliza a API REST Gemini via HTTPS; não há runtime adicional no instalador. A chave é fornecida pelo usuário no painel, validada por consulta de metadados do modelo e armazenada no cofre nativo. Não é login Google OAuth nem acesso à assinatura pessoal Gemini.

1. Obtenha a chave em https://aistudio.google.com/apikey.
2. Informe a chave e o modelo no painel e clique em Validar e salvar.
3. Selecione uma conta e envie uma pergunta. A sessão de leitura é aberta automaticamente, sem confirmação adicional.

## Escolha do modelo

O modelo ativo é persistido junto à chave no cofre nativo e restaurado ao abrir o painel ou reiniciar o aplicativo. Registros antigos que contêm apenas a chave são lidos com o modelo padrão; ao salvar, são migrados para o novo formato. Use Atualizar lista de modelos para consultar o catálogo da API e Salvar modelo para alterar a preferência sem informar novamente a chave. O modelo anterior permanece ativo se a validação ou gravação falhar. A troca fica disponível entre gerações; interrompa uma geração em andamento e aguarde a conexão terminar antes de trocar. A validação usa metadados de geração de conteúdo e exclui famílias não textuais conhecidas; disponibilidade de geração efetiva, cotas e faturamento exigem homologação real. O backend usa o modelo persistido, não um parâmetro fornecido a cada pergunta.

## Segurança e privacidade

- Leitura liberada após a configuração inicial da chave, sem prazo de 30 minutos nem aprovação a cada leitura. Sessões internas isolam a conta selecionada; fechar o painel, trocar de conta, desconectar ou bloquear o aplicativo invalida a sessão. O texto é enviado ao Google somente ao solicitar uma consulta.
- Até 20 mensagens recentes ou uma selecionada na busca do cache local; somente texto limitado, sem anexos ou HTML.
- O modelo não recebe ferramentas de sistema ou mutações de e-mail. Rascunhos exigem aprovação única e expiram em cinco minutos. Enviar, mover, excluir e alterar configurações continuam indisponíveis ao modelo.
- A chave nunca é devolvida ao frontend, nem incluída na URL. O backend não segue redirecionamentos e não registra o corpo das respostas de erro.
- A API gratuita não deve receber dados pessoais, sensíveis ou confidenciais. Use projeto faturado autorizado pela organização e revise https://ai.google.dev/gemini-api/terms. A funcionalidade destina-se ao uso profissional por adultos em regiões suportadas.

## Streaming

A API utiliza SSE (streamGenerateContent?alt=sse), com entrega progressiva por canal IPC individual do Tauri. A resposta final só gera proposta de rascunho após STOP e validação de sessão. Erro, truncamento, bloqueio, revogação ou cancelamento descartam o texto parcial. Parar geração encerra a entrega local imediatamente; a conexão HTTP é abandonada ao próximo evento recebido ou timeout de até 90 segundos. Não há garantia de cancelamento instantâneo do processamento ou cobrança no servidor remoto.

## Homologação pendente

Validar geração real, compatibilidade do modelo escolhido e cotas com chave de teste autorizada; executar CI e testar o cofre no Windows, Linux e macOS. Não considerar homologado apenas pela validação de metadados.
