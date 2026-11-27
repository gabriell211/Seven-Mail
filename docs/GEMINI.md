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

## Arquivos e imagens

Use Anexar arquivo ou cole uma imagem no campo de pergunta. São aceitos PNG, JPEG, WebP, PDF, TXT/CSV/MD em UTF-8, MP3, WAV e MP4, conforme as modalidades do modelo ativo. Limites locais: quatro arquivos, 5 MiB por arquivo (64 KiB para texto) e 8 MiB no total. As imagens possuem prévia local e os arquivos podem ser removidos antes do envio. O primeiro anexo desativa o contexto de e-mails e limpa o histórico anterior; o usuário pode reativá-lo explicitamente. Os bytes são enviados apenas ao solicitar geração, por inlineData ou texto delimitado, sem armazenamento de arquivos separado na API nem persistência de anexos no aplicativo. A resposta é transmitida por SSE. O backend valida base64, tamanho, MIME permitido e assinaturas básicas; a validação não substitui análise antivírus. Não há acesso automático aos anexos de e-mails nem suporte a DOCX, XLSX, ZIP ou arquivos grandes. O suporte real depende do modelo e precisa de homologação.

## Streaming

A API utiliza SSE (streamGenerateContent?alt=sse), com entrega progressiva por canal IPC individual do Tauri. A resposta final só gera proposta de rascunho após STOP e validação de sessão. Erro, truncamento, bloqueio, revogação ou cancelamento descartam o texto parcial. Parar geração encerra a entrega local imediatamente; a conexão HTTP é abandonada ao próximo evento recebido ou timeout de até 90 segundos. Não há garantia de cancelamento instantâneo do processamento ou cobrança no servidor remoto.

## Homologação real (opt-in)

Os testes ignorados `gemini::tests::live_` usam a mesma função de geração HTTPS/SSE do aplicativo, sem ler caixas de e-mail, cofre real ou arquivos pessoais. São três chamadas separadas: texto, PNG sintético e PDF sintético. Cada uma exige conteúdo esperado, fragmentos não vazios e igualdade entre o texto acumulado e a resposta final. A chave deve ser de um projeto de teste autorizado; chamadas podem consumir cota ou gerar custos. Nunca coloque a chave no repositório, no comando como literal ou em logs.

Em uma cópia revisada da branch, configure `SEVEN_MAIL_GEMINI_TEST_API_KEY` por um mecanismo seguro de injeção de segredos; opcionalmente defina `SEVEN_MAIL_GEMINI_TEST_MODEL`. Execute:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib gemini::tests::live_ -- --ignored --test-threads=1
```

A ausência da chave causa falha explícita, não aprovação fictícia. Teste real de áudio, vídeo, interface Tauri, cofre e instalação limpa permanece separado. A suíte não é disparada pelo CI padrão para impedir chamadas pagas não autorizadas. O workflow separado Gemini live API smoke executa somente no branch de homologação autorizado, por alteração explícita do próprio workflow ou despacho manual, usando o secret de repositório SEVEN_MAIL_GEMINI_TEST_API_KEY e a variável opcional SEVEN_MAIL_GEMINI_TEST_MODEL. Não imprime a chave nem acessa e-mails.

## Homologação pendente

Validar geração real, compatibilidade do modelo escolhido e cotas com chave de teste autorizada; executar CI e testar o cofre no Windows, Linux e macOS. Não considerar homologado apenas pela validação de metadados.
