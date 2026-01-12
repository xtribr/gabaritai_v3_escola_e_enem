# 🚀 Como Rodar o Projeto

## 📋 Pré-requisitos

- **Node.js 18+** instalado
- **Python 3.9+** instalado
- **npm** ou **yarn** instalado

## 🔧 Passo 1: Configurar Variáveis de Ambiente

1. Copie o arquivo `.env.example` para `.env`:
```bash
cp .env.example .env
```

2. Edite o arquivo `.env` e preencha as chaves obrigatórias:

```env
# OBRIGATÓRIO - Chave da API OpenAI
OPENAI_API_KEY=sk-sua-chave-aqui

# OBRIGATÓRIO - ID do Assistant OpenAI
OPENAI_ASSISTANT_ID=asst_seu-assistant-id-aqui
```

**⚠️ IMPORTANTE**: Sem essas duas variáveis, o sistema não funcionará corretamente!

## 📦 Passo 2: Instalar Dependências

### Node.js (na raiz do projeto)
```bash
cd gabaritosxtri
npm install
```

### Python OMR Service
```bash
cd python_omr_service
python3 -m venv venv
source venv/bin/activate  # No Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

### Python TRI Service
```bash
cd python_tri_service
python3 -m venv venv
source venv/bin/activate  # No Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

## 🚀 Passo 3: Rodar o Projeto

### Opção 1: Script Automático (Recomendado)

```bash
# Na raiz do projeto
./run.sh
```

Este script inicia o servidor Node.js + Frontend (porta 8080).

Para os serviços Python OMR e TRI, eles estão hospedados no Fly.io em produção.

### Opção 2: Manual

**Terminal 1 - Python OMR Service:**
```bash
cd python_omr_service
source venv/bin/activate
python app.py
```

**Terminal 2 - Python TRI Service:**
```bash
cd python_tri_service
source venv/bin/activate
python app.py
```

**Terminal 3 - Node.js Backend + Frontend:**
```bash
# Na raiz do projeto
npm run dev
```

## 🌐 Acessar a Aplicação

Após iniciar todos os serviços, acesse:

- **Frontend**: http://localhost:8080
- **Backend API**: http://localhost:8080/api
- **Python OMR**: http://localhost:5002
- **Python TRI**: http://localhost:5003

## ⚠️ Problemas Comuns

### `npm run dev` não funciona

**Causa**: O comando deve ser executado na **raiz do projeto**, não na pasta `client`.

**Solução**:
```bash
# Certifique-se de estar na raiz
cd gabaritosxtri
npm run dev
```

### Erro "Cannot find module"

**Solução**: Instale as dependências:
```bash
npm install
```

### Porta já em uso

**Solução**: Mate o processo na porta:
```bash
# Linux/Mac
lsof -ti :8080 | xargs kill -9

# Ou use o script
./run.sh
```

### Python services não iniciam

**Solução**: Verifique se os venvs estão ativados e dependências instaladas:
```bash
cd python_omr_service
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

## 📝 Estrutura do Projeto

```
gabaritosxtri/
├── .env                    # Variáveis de ambiente (criar a partir de .env.example)
├── package.json            # Dependências Node.js
├── server/                 # Backend Express
├── client/                 # Frontend React
├── python_omr_service/    # Serviço Python OMR
└── python_tri_service/    # Serviço Python TRI
```

## 🔑 Onde Obter as Chaves

### OpenAI API Key
1. Acesse: https://platform.openai.com/api-keys
2. Crie uma nova chave
3. Cole no `.env` como `OPENAI_API_KEY`

### OpenAI Assistant ID
1. Acesse: https://platform.openai.com/assistants
2. Crie um novo Assistant ou use um existente
3. Copie o ID (começa com `asst_`)
4. Cole no `.env` como `OPENAI_ASSISTANT_ID`

Veja também: `COMO_CONFIGURAR_ASSISTANT.md`

## ✅ Verificação

Após iniciar, verifique se todos os serviços estão rodando:

```bash
# Verificar portas
lsof -i :8080  # Node.js
lsof -i :5002  # Python OMR
lsof -i :5003  # Python TRI
```

Se todos estiverem ativos, você verá:
- ✅ Node.js rodando na porta 8080
- ✅ Python OMR na porta 5002
- ✅ Python TRI na porta 5003

