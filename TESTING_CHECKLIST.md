# GabaritAI - Checklist de Testes em Produção

Use este checklist após cada deploy para garantir que o sistema está funcionando corretamente.

## Pré-Testes

- [ ] Todos os serviços estão online (`./scripts/deploy.sh status`)
- [ ] Health checks passando:
  - [ ] Backend: `curl https://xtri-gabaritos-api.fly.dev/api/health`
  - [ ] OMR: `curl https://xtri-gabaritos-omr.fly.dev/health`
  - [ ] TRI: `curl https://xtri-gabaritos-tri.fly.dev/health`

---

## 1. Frontend (Vercel)

### 1.1 Carregamento
- [ ] Página inicial carrega sem erros
- [ ] Não há erros no console do navegador (F12)
- [ ] Assets (CSS, JS, imagens) carregam corretamente
- [ ] Responsivo em mobile (testar com DevTools)

### 1.2 Navegação
- [ ] Todas as rotas funcionam (não dá 404)
- [ ] Navegação entre páginas é fluida
- [ ] Botão voltar do navegador funciona

---

## 2. Autenticação (Supabase Auth)

### 2.1 Cadastro (Sign Up)
- [ ] Formulário de cadastro carrega
- [ ] Validação de email funciona
- [ ] Validação de senha funciona (mínimo 6 caracteres)
- [ ] Usuário consegue criar conta
- [ ] Email de confirmação é enviado (se configurado)
- [ ] Após cadastro, usuário é redirecionado corretamente

### 2.2 Login
- [ ] Formulário de login carrega
- [ ] Login com email/senha funciona
- [ ] Erro apropriado para credenciais inválidas
- [ ] Após login, usuário vê o dashboard correto

### 2.3 Logout
- [ ] Botão de logout funciona
- [ ] Após logout, sessão é invalidada
- [ ] Rotas protegidas redirecionam para login

### 2.4 Perfis por Role
- [ ] **Admin**: vê painel administrativo
- [ ] **Professor**: vê página de correção e avaliações
- [ ] **Aluno**: vê dashboard pessoal com notas

---

## 3. Upload e Processamento de PDF

### 3.1 Upload
- [ ] Drag & drop funciona
- [ ] Clique para selecionar arquivo funciona
- [ ] Preview do PDF aparece
- [ ] Arquivos inválidos são rejeitados (não-PDF, muito grande)

### 3.2 Processamento OMR
- [ ] Botão "Processar" inicia o processamento
- [ ] Loading/spinner aparece durante processamento
- [ ] Gabaritos são detectados corretamente
- [ ] Respostas são extraídas das folhas

### 3.3 Cálculo TRI
- [ ] Notas TRI são calculadas após OMR
- [ ] Notas por área aparecem (LC, CH, CN, MT)
- [ ] Média geral é calculada

### 3.4 Resultados
- [ ] Tabela de resultados aparece
- [ ] Dados dos alunos estão corretos
- [ ] Pode filtrar/ordenar resultados
- [ ] Pode exportar para Excel/CSV

---

## 4. Publicar para Alunos

### 4.1 Botão Publicar
- [ ] Botão "📤 Publicar para Alunos" aparece após processamento
- [ ] Só aparece se usuário está logado como professor/admin
- [ ] Dialog de confirmação abre

### 4.2 Salvar no Supabase
- [ ] Nome da prova pode ser editado
- [ ] Ao confirmar, dados são salvos
- [ ] Toast de sucesso aparece
- [ ] Toast de erro aparece se falhar

### 4.3 Verificar no Banco
```sql
-- No Supabase SQL Editor
SELECT * FROM exams ORDER BY created_at DESC LIMIT 5;
SELECT * FROM student_answers ORDER BY created_at DESC LIMIT 10;
```

---

## 5. Dashboard do Aluno

### 5.1 Login como Aluno
- [ ] Aluno consegue fazer login
- [ ] É redirecionado para dashboard de aluno

### 5.2 Visualização
- [ ] Aluno vê suas provas/avaliações
- [ ] Notas aparecem corretamente
- [ ] Notas por área (LC, CH, CN, MT) aparecem
- [ ] Nota TRI total aparece

### 5.3 Gráfico de Evolução
- [ ] Gráfico de evolução carrega
- [ ] Mostra histórico de provas
- [ ] Dados estão corretos

---

## 6. Administração

### 6.1 Painel Admin
- [ ] Admin consegue acessar painel administrativo
- [ ] Lista de escolas aparece
- [ ] Lista de usuários aparece

### 6.2 Importar CSV de Alunos
- [ ] Botão "Importar CSV" funciona
- [ ] Upload de CSV processa corretamente
- [ ] Alunos são criados no sistema
- [ ] Erro apropriado para CSV mal formatado

### 6.3 Gerenciar Avaliações
- [ ] Lista de avaliações aparece
- [ ] Pode ver detalhes de cada avaliação
- [ ] Pode deletar avaliação (se permitido)

---

## 7. Performance

### 7.1 Tempos de Resposta
- [ ] Páginas carregam em < 3 segundos
- [ ] APIs respondem em < 2 segundos
- [ ] Upload de PDF grande (10MB) não trava

### 7.2 Erros
- [ ] Não há erros 500 nos logs
- [ ] Não há memory leaks (verificar Fly.io metrics)

---

## 8. Segurança

### 8.1 Autenticação
- [ ] Rotas protegidas requerem login
- [ ] Token JWT é validado corretamente
- [ ] Sessão expira após tempo configurado

### 8.2 Autorização
- [ ] Aluno não acessa dados de outros alunos
- [ ] Professor só vê alunos da sua escola
- [ ] Admin só gerencia sua escola (multi-tenant)

### 8.3 CORS
- [ ] Requests de domínios não autorizados são bloqueados
- [ ] Requests do frontend são permitidos

---

## Comandos Úteis para Debug

```bash
# Ver logs em tempo real
fly logs -a xtri-gabaritos-api
fly logs -a xtri-gabaritos-omr
fly logs -a xtri-gabaritos-tri

# Ver métricas
fly status -a xtri-gabaritos-api

# Reiniciar serviço se necessário
fly apps restart xtri-gabaritos-api

# SSH no container para debug
fly ssh console -a xtri-gabaritos-api
```

---

## Resultado do Teste

| Data | Testador | Resultado | Observações |
|------|----------|-----------|-------------|
| ____/____/____ | __________ | ✅ / ❌ | |
| ____/____/____ | __________ | ✅ / ❌ | |
| ____/____/____ | __________ | ✅ / ❌ | |

---

## Problemas Encontrados

| # | Descrição | Severidade | Status |
|---|-----------|------------|--------|
| 1 | | Alta/Média/Baixa | Aberto/Resolvido |
| 2 | | Alta/Média/Baixa | Aberto/Resolvido |
| 3 | | Alta/Média/Baixa | Aberto/Resolvido |
