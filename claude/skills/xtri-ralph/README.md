# XTRI Ralph - Loop Autônomo para Claude Code

Loop autônomo que executa o Claude Code repetidamente até completar todas as user stories do PRD.

Baseado no [padrão Ralph](https://github.com/snarktank/ralph) de Geoffrey Huntley.

## Como Funciona

```
┌─────────────────────────────────────────────────────────────┐
│                        ralph.sh                              │
│                                                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│   │ Lê PRD   │───▶│ Claude   │───▶│ Atualiza │──┐          │
│   │          │    │ Code     │    │ PRD      │  │          │
│   └──────────┘    └──────────┘    └──────────┘  │          │
│        ▲                                         │          │
│        └─────────────────────────────────────────┘          │
│                                                              │
│   Loop até: todas stories passes=true OU max_iterations     │
└─────────────────────────────────────────────────────────────┘
```

## Instalação

```bash
# Clone ou copie para seu projeto
mkdir -p scripts/ralph
cp ralph.sh prompt.md prd.json.example scripts/ralph/
chmod +x scripts/ralph/ralph.sh
```

## Uso

### 1. Criar o PRD

```bash
cd scripts/ralph
cp prd.json.example prd.json
# Edite prd.json com suas user stories
```

### 2. Rodar o Ralph

```bash
./ralph.sh           # Default: 10 iterações
./ralph.sh 20        # Custom: 20 iterações
```

### 3. Monitorar Progresso

```bash
# Ver status das stories
cat prd.json | jq '.userStories[] | {id, title, passes}'

# Ver log de progresso
cat progress.txt

# Ver histórico git
git log --oneline -10
```

## Estrutura do PRD

```json
{
  "projectName": "Meu Projeto",
  "branchName": "ralph/feature-x",
  "userStories": [
    {
      "id": "story-1",
      "title": "Título da Story",
      "priority": 1,
      "passes": false,
      "acceptanceCriteria": [
        "Critério 1 verificável",
        "Critério 2 verificável",
        "Testes passando"
      ],
      "technicalNotes": "Dicas de implementação"
    }
  ]
}
```

## Boas Práticas

### Stories Pequenas
Cada story deve caber em uma janela de contexto. Se for grande demais, o LLM perde contexto e produz código ruim.

**Regra:** Se não consegue descrever em 2-3 frases, é grande demais.

### Critérios Verificáveis
Cada critério deve ser algo que o Ralph pode CHECAR:

✅ Bom: "Endpoint retorna JSON com campo 'success'"
❌ Ruim: "Código bem organizado"

### Ordem de Prioridade
Stories executam em ordem de prioridade. Stories anteriores não devem depender de posteriores.

## Arquivos

| Arquivo | Descrição |
|---------|-----------|
| `ralph.sh` | Script de loop principal |
| `prompt.md` | Instruções para o agente |
| `prd.json` | Documento de requisitos |
| `progress.txt` | Log de progresso (auto-gerado) |

## Customização

### Adaptar prompt.md
Edite `prompt.md` para adicionar:
- Padrões específicos do seu projeto
- Comandos de teste/lint
- Convenções de código

### Múltiplos Projetos
Cada projeto pode ter seu próprio diretório `scripts/ralph/` com PRD específico.

## Troubleshooting

### Claude Code não encontrado
```bash
npm install -g @anthropic/claude-code
```

### jq não encontrado
```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt install jq
```

### Stories não completam
1. Verifique se os critérios são específicos e testáveis
2. Divida stories grandes em menores
3. Adicione mais contexto em `technicalNotes`

## Exemplo Completo

```bash
# Setup
cd ~/meu-projeto
mkdir -p scripts/ralph
cd scripts/ralph

# Criar PRD
cat > prd.json << 'EOF'
{
  "projectName": "API de Usuários",
  "branchName": "ralph/user-api",
  "userStories": [
    {
      "id": "story-1",
      "title": "Endpoint GET /users",
      "priority": 1,
      "passes": false,
      "acceptanceCriteria": [
        "GET /api/users retorna lista de usuários",
        "Resposta inclui id, name, email",
        "Teste unitário passando"
      ]
    }
  ]
}
EOF

# Rodar
./ralph.sh 5
```

---

Feito com 🧠 para projetos XTRI
