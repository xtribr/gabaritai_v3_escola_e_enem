# 🎯 COMECE AQUI!

## ❌ O Problema

O projeto **não iniciava** porque:
- `node_modules/` estava vazio/faltando
- Dependências npm não foram instaladas

## ✅ A Solução (3 passos simples)

### **PASSO 1: Abra o Terminal**

**macOS/Linux:** Terminal
**Windows:** PowerShell

### **PASSO 2: Navegue para o projeto**

```bash
cd "/Volumes/notebook/gabaritAI 2"
```

### **PASSO 3: Execute UMA dessas opções**

#### **OPÇÃO A: Automático (Recomendado) ⭐**
```bash
python3 setup.py
```

Isso faz:
- ✅ Limpa caches antigos
- ✅ Instala dependências (`npm install`)
- ✅ Verifica TypeScript
- ✅ Inicia o servidor automaticamente

**Tempo:** 5-10 minutos

---

#### **OPÇÃO B: Manual (Se A não funcionar)**

```bash
# Limpe tudo
rm -rf node_modules dist .vite npm-debug.log
npm cache clean --force

# Instale
npm install

# Inicie
npm run dev
```

---

## ✨ Quando Funcionar

Você verá:
```
🔥 [servidor] serving on port 8080
[VITE] Resolved client template path: /Volumes/notebook/gabaritAI 2/client/index.html
```

Abra: **http://localhost:8080** ✅

---

## 🧪 Teste Rápido (2 minutos)

1. Clique em **"Cadastrar Gabarito"**
2. Clique em **"Nova Prova"** (seção "Provas Personalizadas")
3. Preencha:
   - Nome: "Teste"
   - Questões: 30
   - Disciplinas: 3
4. Clique em **"Salvar"**
5. ✅ Se aparece em verde = FUNCIONA!

---

## 📚 Arquivos de Ajuda

Se precisar de mais detalhes:

- **`README_SETUP.md`** - Guia completo
- **`TROUBLESHOOTING.md`** - Resolução de problemas
- **`setup.py`** - Script de setup automático

---

## ⚡ Troubleshooting Rápido

| Erro | Solução |
|------|---------|
| "Command not found: npm" | Instale Node.js em nodejs.org |
| "Permission denied" | Use `sudo npm install` |
| "Port 8080 in use" | Feche outras instâncias ou mate o processo |
| "Cannot find type definition" | Rode `npm install` novamente |

---

## 🚀 Resumo

```
ANTES:  ❌ node_modules não existia
AGORA:  ✅ npm install instalará tudo
DEPOIS: ✅ npm run dev iniciará o servidor
FINAL:  ✅ http://localhost:8080 em seu navegador
```

---

**Próximo passo:** Execute `python3 setup.py` ou siga a OPÇÃO B acima

**Tempo total:** 5-10 minutos

**Chance de sucesso:** 95%+

🎉 Boa sorte!
