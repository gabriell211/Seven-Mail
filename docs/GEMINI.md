# Google Gemini (integração opcional)

O backend Rust utiliza a API REST Gemini via HTTPS; não há runtime adicional no instalador. A chave é fornecida pelo usuário no painel, validada por consulta de metadados do modelo e armazenada no cofre nativo. Também há autorização Google OAuth separada da conta de e-mail; nenhuma modalidade equivale à assinatura pessoal Gemini.

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

A API utiliza SSE (streamGenerateContent?alt=sse), com entrega progressiva por canal IPC individual do Tauri. A resposta final só gera proposta de rascunho após STOP e validação de sessão. Erro, truncamento, bloqueio, revogação ou cancelamento descartam o texto parcial. Parar geração encerra a entrega local imediatamente; a conexão HTTP é abandonada ao próximo evento recebido ou timeout de até 90 segundos. Não há garantia de cancelamento instantâneo do processamento ou cobrança no servidor remoto. Respostas HTTP 500/502/503/504 antes do início do fluxo recebem até duas novas tentativas, com espera progressiva, Retry-After numérico e prazo total de 90 segundos. Falhas de autenticação, cota, transporte ambíguo ou streaming parcial não são repetidas automaticamente. A mensagem apresenta o status HTTP exato; falhas persistentes continuam sendo erros, e as tentativas podem consumir cota.

## Homologação real (opt-in)

Os testes ignorados `gemini::tests::live_` usam a mesma função de geração HTTPS/SSE do aplicativo, sem ler caixas de e-mail, cofre real ou arquivos pessoais. São três chamadas separadas: texto, PNG sintético e PDF sintético. Cada uma exige conteúdo esperado, fragmentos não vazios e igualdade entre o texto acumulado e a resposta final. A chave deve ser de um projeto de teste autorizado; chamadas podem consumir cota ou gerar custos. Nunca coloque a chave no repositório, no comando como literal ou em logs.

Em uma cópia revisada da branch, configure `SEVEN_MAIL_GEMINI_TEST_API_KEY` por um mecanismo seguro de injeção de segredos; opcionalmente defina `SEVEN_MAIL_GEMINI_TEST_MODEL`. Execute:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib gemini::tests::live_ -- --ignored --test-threads=1
```

A ausência da chave causa falha explícita, não aprovação fictícia. Teste real de áudio, vídeo, interface Tauri, cofre e instalação limpa permanece separado. A suíte não é disparada pelo CI padrão para impedir chamadas pagas não autorizadas. O workflow separado Gemini live API smoke executa somente no branch de homologação autorizado, por alteração explícita do próprio workflow ou despacho manual, usando o secret de repositório SEVEN_MAIL_GEMINI_TEST_API_KEY e a variável opcional SEVEN_MAIL_GEMINI_TEST_MODEL. Não imprime a chave nem acessa e-mails.

## Homologação pendente

Validar geração real, compatibilidade do modelo escolhido e cotas com chave de teste autorizada; executar CI e testar o cofre no Windows, Linux e macOS. Não considerar homologado apenas pela validação de metadados.

### Diagnóstico do HTTP 503

O modelo 3.8 Flash retornou HTTP 503 mesmo após as tentativas limitadas. O workflow usa por padrão o Gemini 3.5 Flash-Lite, documentado como estável e multimodal (https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), com teste textual antes das mídias para evitar solicitações desnecessárias quando o provedor está indisponível. A variável de repositório SEVEN_MAIL_GEMINI_TEST_MODEL continua podendo substituir esse modelo. Não há troca automática do modelo salvo pelo usuário nem aprovação de testes que não foram executados.

### Entrar com Google (OAuth desktop)

O botão usa o navegador padrão, callback loopback aleatório em 127.0.0.1, state e PKCE S256 nativos. Para uma conta Gmail selecionada, utiliza login_hint e confirma o endereço verificado pelo endpoint userinfo. Não reutiliza token Gmail nem solicita escopo de e-mail. O token de geração e refresh fica no registro nativo Gemini, separado do cofre de e-mail; a API recebe Bearer e x-goog-user-project. O modelo continua persistido. A autorização pode ser cancelada; desconectar remove a credencial local, não revoga toda a conta Google.

Antes de distribuir, configure um projeto Cloud com Generative Language API habilitada e OAuth desktop, tela de consentimento, escopo generative-language.retriever, usuário autorizado e permissão serviceusage.services.use no projeto de cota. O usuário pode fornecer os dados desktop na configuração avançada; o build pode incluir SEVEN_MAIL_GEMINI_GOOGLE_CLIENT_ID e SEVEN_MAIL_GEMINI_GOOGLE_PROJECT como padrões públicos, e opcionalmente SEVEN_MAIL_GEMINI_GOOGLE_CLIENT_SECRET de cliente instalado (nunca um segredo de cliente web). O Client ID e o projeto públicos registrados do Seven Mail são os padrões do aplicativo; o e-mail Gmail selecionado serve apenas como login_hint. Não se reutilizam credenciais OAuth de e-mail. O login não garante cota ou assinatura de consumidor. A chave de API segue como alternativa. Não foi homologado com credenciais OAuth reais.

Referências: https://ai.google.dev/gemini-api/docs/oauth e https://developers.google.com/identity/protocols/oauth2/native-app.

### Configuração de distribuição (GitHub Actions)

Depois de criar o cliente do tipo Desktop app no Google Auth Platform e habilitar a Generative Language API, configure as variáveis públicas de repositório `SEVEN_MAIL_GEMINI_GOOGLE_CLIENT_ID` (Client ID) e `SEVEN_MAIL_GEMINI_GOOGLE_PROJECT` (ID do projeto, não o nome de exibição). O workflow Desktop Release valida o par e fornece as variáveis ao build dos instaladores. Se ambas estiverem vazias, o aplicativo usa os identificadores públicos registrados; um par incompleto ou malformado bloqueia o build. Não embutir API keys, refresh tokens, credenciais de contas de serviço ou segredos de clientes web. Se o cliente desktop exigir client_secret, avalie o fluxo de distribuição de cliente público ou um backend autorizado antes da publicação.

Homologue primeiro com usuários de teste autorizados; para público externo, configure branding, política de privacidade, domínios verificados, audiência e escopos exigidos, e conclua a revisão aplicável do Google. Cada usuário OAuth direto precisa ter a permissão de consumo no projeto de cota (`serviceusage.services.use`); não conceda IAM amplo a usuários anônimos. Para distribuição pública irrestrita, prefira um backend com identidade, cotas por usuário e controle de faturamento, em vez de abrir o projeto Cloud a todos. O workflow não cria projetos, não altera IAM, não habilita faturamento e não substitui a homologação real.

### Cliente desktop registrado

O aplicativo usa o Client ID público do cliente instalado registrado no projeto `gen-lang-client-0988107998`. O arquivo JSON recebido não é incluído no repositório. O fluxo PKCE omite o client_secret por padrão, conforme o parâmetro opcional documentado para OAuth desktop. Se o endpoint exigir o valor do cliente instalado, configure `SEVEN_MAIL_GEMINI_GOOGLE_CLIENT_SECRET` como secret de Actions para o build de release, ou informe-o na configuração avançada local. Um valor de cliente instalado distribuído no binário não é confidencial; jamais use segredo de cliente web ou API key nesse campo. A existência do JSON não confirma que o projeto esteja publicado, verificado, com API ativa, permissões de cota ou consentimento aprovados.
