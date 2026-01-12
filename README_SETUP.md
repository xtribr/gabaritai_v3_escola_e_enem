# 🚀 Como Iniciar o Projeto GabaritAI

## ✅ Problema Principal

O projeto **não está funcionando** porque:
- ❌ `node_modules/` não existe
- ❌ Dependências npm não foram instaladas
- ❌ TypeScript não consegue encontrar tipos (`node`, `vite/client`)

## 🔧 SOLUÇÃO RÁPIDA (2 opções)

### **OPÇÃO 1: Script Python Automático (RECOMENDADO)**

Este é o mais fácil - executa tudo automaticamente!

```bash
# macOS/Linux
cd "/Volumes/notebook/gabaritAI 2"
python3 setup.py

# Windows (PowerShell)
cd "C:\seu\caminho\gabaritAI 2"
python setup.py
```

O script vai:
1. ✅ Verificar Node.js e npm
2. ✅ Validar estrutura do projeto
3. ✅ Limpar caches antigos
4. ✅ Instalar dependências (`npm install`)
5. ✅ Verificar TypeScript
6. ✅ Iniciar servidor automaticamente

**Tempo estimado:** 5-10 minutos

---

### **OPÇÃO 2: Manual (Se python não funcionar)**

Execute manualmente:

```bash
cd "/Volumes/notebook/gabaritAI 2"

# Limpe tudo
rm -rf node_modules dist .vite npm-debug.log
npm cache clean --force

# Instale dependências
npm install

# Inicie o servidor
npm run dev
```

---

## 📊 Estrutura do Projeto

```
gabaritAI 2/
├── client/               # Frontend React/Vite
│   ├── src/
│   │   ├── pages/
│   │   │   └── home.tsx  # ✅ ATUALIZADO com wizard
│   │   └── components/
│   │       └── ExamConfigurationWizard.tsx  # ✅ NOVO
│   └── index.html
├── server/               # Backend Express
│   ├── index.ts
│   ├── routes.ts         # ✅ API endpoints
│   ├── storage.ts        # ✅ Persistência
│   └── vite.ts           # ✅ CORRIGIDO
├── shared/               # Código compartilhado
│   └── schema.ts         # ✅ Validação Zod
├── package.json
├── vite.config.ts        # ✅ CORRIGIDO
├── tsconfig.json
├── setup.py              # ✅ NOVO - Setup automático
├── QUICK_START.md        # Comandos rápidos
└── README_SETUP.md       # Este arquivo
```

---

## ✨ Teste de Funcionamento

Após iniciar com sucesso, você verá:

```
🔥 [servidor] serving on port 8080
[VITE] Resolved client template path: /Volumes/notebook/gabaritAI 2/client/index.html
```

Então:

1. Abra **http://localhost:8080** no navegador
2. Clique em **"Cadastrar Gabarito"** no sidebar
3. Na seção **"Provas Personalizadas"**, clique em **"Nova Prova"**
4. Preencha o formulário:
   - Nome: "Teste Personalizado"
   - Questões: 30
   - Alternativas: 5
   - Disciplinas: Português (1-10), Matemática (11-20), Ciências (21-30)
5. Clique em **"Salvar Configuração"**
6. ✅ Deve aparecer em verde confirmando a criação

---

## 🐛 Solução de Problemas

### Erro: "Command not found: npm"
```bash
# Node.js não está instalado
# Instale em: https://nodejs.org
```

### Erro: "Cannot find type definition file"
```bash
# Significa que npm install não completou
rm -rf node_modules
npm install
```

### Erro: "Port 8080 already in use"
```bash
# Outra instância está rodando
# Feche e tente novamente, ou:
lsof -i :8080
kill -9 <PID>
npm run dev
```

### Erro: "permission denied"
```bash
# No macOS/Linux, use sudo:
sudo npm install
```

---

## 📚 Arquivos de Suporte

- **`QUICK_START.md`** - Comandos para copiar e colar
- **`TROUBLESHOOTING.md`** - Guia de resolução de problemas

---

## 🎯 Próximos Passos

Depois que conseguir rodar:

1. **Teste o wizard:** Crie uma prova personalizada
2. **Teste o API:** Upload um PDF com respostas
3. **Teste TCT:** Processe e verifique cálculos
4. **Teste da UI:** Carregue configurações salvas

---

## 💡 Dicas

- Se usar macOS/Linux, comece com `python3 setup.py`
- Se usar Windows, use `python setup.py` ou PowerShell
- Sempre comece limpando: `rm -rf node_modules` antes de `npm install`
- Se algo der erro, leia `TROUBLESHOOTING.md`

---

## 📞 Suporte Rápido

Se ainda não funcionar:

1. Execute `python3 setup.py` (automático)
2. Se falhar, verifique `TROUBLESHOOTING.md`

---

**Status:** 🚀 Pronto para iniciar

**Tempo estimado:** 5-10 minutos

**Sucesso esperado:** 95%+

Boa sorte! 🎉
