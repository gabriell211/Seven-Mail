# Releases e distribuição

## Plataformas

A esteira oficial gera:

### Windows
- MSI
- NSIS/EXE

### Linux
- DEB
- AppImage

## Validação

Antes de publicar uma versão:
1. `npm test`;
2. `npm run build`;
3. geração dos ícones;
4. `cargo test`;
5. `cargo check`;
6. bundles Windows/Linux.

## Versionamento

O número deve permanecer alinhado em:
- `package.json`;
- `package-lock.json`;
- `src-tauri/Cargo.toml`;
- `src-tauri/tauri.conf.json`.

## Atualizações

O Seven Mail possui atualizador integrado. Quando habilitado, o aplicativo consulta a release mais recente, seleciona o instalador compatível com a plataforma, baixa para a área local de updates e valida o SHA-256 publicado pela release antes de abrir/executar o pacote.

A instalação continua respeitando o mecanismo nativo de cada sistema operacional. Assinatura de código, quando configurada, complementa a verificação de integridade; chaves privadas nunca devem ser adicionadas ao repositório.

## Workflow

O workflow de release deve permanecer acionável manualmente e por tags `v*`. Gatilho temporário por `main` pode ser usado para bootstrap de uma versão, mas deve ser removido após a publicação.
