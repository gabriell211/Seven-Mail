# GitHub Copilot (integração experimental e opcional)

O painel do Seven Mail usa o SDK oficial Copilot v2 em um processo Node separado. O instalador atual **não inclui** Node nem o pacote SDK. A conexão real e o fluxo de autenticação ainda exigem homologação no Windows, Linux e macOS. Não habilitar a feature para produção sem validar o runtime, as permissões e o comportamento de retenção de dados.

## Configuração de desenvolvimento

1. Instalar Node.js 22.12+ em um diretório de sistema padrão.
2. Abrir Copilot no Seven Mail e expandir "Configurar e entrar com GitHub". Criar o diretório indicado.
3. Executar nesse diretório: npm install --save-exact @microsoft/copilot-sdk@2.0.3.
4. Autenticar pelo Copilot CLI oficial: https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate.
5. Autorizar explicitamente a conta de e-mail e enviar uma pergunta. Não colar tokens no Seven Mail.

## Escopo

- Uma conta autorizada por vez, por 30 minutos. O usuário pode revogar ou fechar o painel. Bloqueio do aplicativo invalida o consentimento.
- O backend carrega até 20 mensagens recentes do cache ou uma mensagem selecionada. Texto limitado; sem anexos, HTML, senhas ou ferramentas do sistema.
- O contexto de e-mail é dado não confiável, nunca uma instrução. O runtime usa mode empty, nenhuma ferramenta disponível e nega solicitações de permissão.
- Respostas ficam no painel. Propostas de rascunho expiram em cinco minutos, são consumidas uma única vez e exigem aprovação explícita. O destinatário vem do e-mail local, não da saída do modelo.
- Envio, exclusão, movimentação, alterações de configuração e acesso a credenciais não são expostos.
- O SDK recebe somente texto delimitado. A sessão local é encerrada e sua exclusão é solicitada; isso não garante exclusão dos registros do serviço GitHub ou de dados após encerramento inesperado.
- Não compartilhar e-mails corporativos sem autorização da organização.

## Homologação pendente

Instalação reproduzível e empacotamento do runtime, login/logout no próprio aplicativo, autenticação real, análise de permissões/isolamento do SDK e testes reais de envio de pergunta. Não adicionar SDK ao Cargo.lock ou ao bundle principal antes dessa validação.
