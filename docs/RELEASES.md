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

A instalação automática in-app exige artefatos assinados e uma chave privada protegida no CI. A chave privada nunca deve ser adicionada ao repositório. Até a infraestrutura de assinatura estar configurada, releases devem ser publicadas normalmente no GitHub e instaladas usando os pacotes oficiais.

## Workflow

O workflow de release deve permanecer acionável manualmente e por tags `v*`. Gatilho temporário por `main` pode ser usado para bootstrap de uma versão, mas deve ser removido após a publicação.
