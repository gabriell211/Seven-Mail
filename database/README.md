# Migrações do Neon

As migrações em `database/migrations` são aplicadas em ordem numérica à base
`neondb`, sempre por uma conexão direta (sem `-pooler`). Teste primeiro em uma
branch filha da produção.

1. Aplique `0001_initial.sql` antes de habilitar o Data API.
2. Habilite o Data API com Neon Auth **sem concessões automáticas para todo o
   esquema `public`**. Essa etapa cria `auth.user_id()`, exigida pela `0002`.
3. Aplique `0002_neon_auth_rls.sql`, `0003_workspace_signatures.sql` e
   `0004_protect_legacy_tables.sql`, nessa ordem.
4. Atualize o cache de esquema do Data API.

O cliente desktop usa o Data API apenas para `workspace_documents`,
`desktop_mail_accounts` e `desktop_mail_messages`. Essas tabelas têm permissões
explícitas para `authenticated` e políticas RLS por proprietário. As 22 tabelas
da `0001` têm RLS ativo sem políticas para papéis do Data API; são reservadas
para acesso pelo backend com credenciais administrativas.

`workspace_documents.deleted_at` é um marcador de exclusão sincronizado. O
cliente mantém esses marcadores no armazenamento local e os compara por
`updated_at` antes de atualizar qualquer dispositivo; não remova linhas
excluídas enquanto ainda houver clientes que possam voltar do modo offline.

Não use `DATABASE_URL` nem outras credenciais PostgreSQL em variáveis `VITE_*`.
Somente os endpoints HTTPS públicos de Auth e Data API pertencem a `.env.local`.
