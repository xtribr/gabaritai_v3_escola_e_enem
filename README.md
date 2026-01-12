# 📝 GabaritAI - XTRI

Sistema completo para leitura automática de gabaritos do ENEM e outras provas, com extração de dados via OMR (Optical Mark Recognition), validação de qualidade com IA, cálculo TRI/TCT, análise pedagógica e exportação para Excel.

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)

## 🎯 Visão Geral

Aplicação web fullstack desenvolvida para professores e administradores educacionais, permitindo:

- ✅ **Processar Gabaritos**: Upload de PDFs escaneados para leitura OMR automática das respostas
- ✅ **Validação de Qualidade**: ChatGPT obrigatório para verificar qualidade do escaneamento e corrigir erros do OMR
- ✅ **Cálculo TRI/TCT**: Cálculo automático de notas usando Teoria de Resposta ao Item (TRI) e Teoria Clássica dos Testes (TCT)
- ✅ **Análise Pedagógica com IA**: Geração de análises detalhadas usando OpenAI Assistant API
- ✅ **Relatórios Completos**: Dashboard com métricas, gráficos e estatísticas por área
- ✅ **Exportação Excel**: Dados completos exportados para planilhas Excel

## 🚀 Funcionalidades Principais

### 1. Processamento de Gabaritos com Validação de Qualidade

#### Pipeline de Processamento (OMR → OpenAI → OCR)

O sistema utiliza um pipeline de 3 etapas para garantir máxima precisão:

1. **OMR (Optical Mark Recognition)** - Primeira Etapa (Obrigatória)
   - Detecta bolhas marcadas usando OpenCV (Python) ou TypeScript
   - Alinhamento automático com marcas de registro
   - Pré-processamento de imagem (contraste, escala de cinza)
   - Detecção de coordenadas fixas por questão

2. **OpenAI (ChatGPT Vision)** - Segunda Etapa (Obrigatória)
   - **Validação de qualidade do escaneamento**:
     - Detecta blur, rotação, cortes, brilho/contraste, sombras
     - Classifica qualidade: excellent/good/fair/poor/critical
     - Bloqueia processamento se qualidade for crítica
   - **Correção automática de erros do OMR**:
     - Valida cada resposta detectada pelo OMR
     - Corrige falsos positivos/negativos
     - Retorna respostas validadas com log de correções

3. **OCR (Optical Character Recognition)** - Terceira Etapa (Opcional)
   - Extração de nome do aluno usando DeepSeek-OCR
   - Extração de número de matrícula
   - Validação automática de dados extraídos

#### Características
- Upload de PDFs via drag-and-drop
- Preview visual das páginas (até 18 páginas)
- Detecção automática de bolhas marcadas (A-E)
- Indicadores de confiança por resposta
- Processamento em lote de múltiplos PDFs
- Logs detalhados de qualidade e correções

### 2. Cálculo TRI (Teoria de Resposta ao Item)

- **Cálculo por Área**: LC, CH, CN, MT
- **Tabelas de Referência**: Dados históricos ENEM (2009-2023)
- **Métricas Oficiais**: Mínimo, Média e Máximo por número de acertos
- **Cálculo Automático**: Integração com serviço Python dedicado
- **Visualização**: Cards por área com progress bars e estatísticas

### 3. Cálculo TCT (Teoria Clássica dos Testes)

- **Cálculo Simples**: Acertos × 0,222 = Nota (0-10)
- **Por Área**: Cada área (45 questões) = 10,0 pontos
- **Nota Final**: Média das áreas quando aplicável
- **Visualização**: Cards por área consistentes com TRI

### 4. Dashboard e Relatórios

#### Aba "Scores"
- Tabela completa com notas TRI e TCT por aluno
- Visualização por área (LC, CH, CN, MT)
- Contagem de acertos por área
- Filtros e ordenação

#### Aba "Estatísticas TRI"
- **Cards por Área**: 4 cards (LC, CH, CN, MT) com:
  - TRI médio da turma
  - Progress bar indicando posição da média
  - Estatísticas: Mínimo, Média, Máximo
  - Cores diferenciadas por área
- Gráficos de distribuição
- Análise por questão

#### Aba "Estatísticas TCT"
- **Cards por Área**: 4 cards (LC, CH, CN, MT) com:
  - TCT médio da turma
  - Progress bar indicando posição da média
  - Estatísticas: Mínimo, Média, Máximo
  - Cores diferenciadas por área
- Gráficos Min/Med/Max por área
- Distribuição de notas TCT

#### Aba "Relatório de Performance XTRI"
- **9 Cards de Métricas**:
  - **Primeira Linha**: Total de Alunos, TRI Médio da Turma, Taxa de Acertos
  - **Segunda Linha**: Alunos Acima da Média, Alunos em Média, Alunos Abaixo da Média
  - **Terceira Linha**: Alto Desempenho, Médio Desempenho, Baixo Desempenho
- **Botões "Quem são?"**: Abre dialog com lista de alunos por categoria
- Gráficos de distribuição TRI
- Análise de coerência pedagógica
- Análise por questão com cores de dificuldade:
  - 🟢 Verde pastel: Fácil (>70% acertos)
  - 🟠 Laranja pastel: Médio (49-69% acertos)
  - 🔴 Vermelho pastel: Difícil (<49% acertos)

### 5. Análise Pedagógica com IA

- **Análise da Turma Completa**: Relatório executivo diagnóstico
- **Análise Individual**: Por aluno com insights personalizados
- **OpenAI Assistant API**: Integração com assistente especializado
- **Sugestões de Conteúdos**: Baseado na matriz ENEM (H1-H30)
- **Sugestões de Habilidades**: Áreas prioritárias para melhoria
- **Notificações**: Toast quando análise termina
- **Botão PDF Verde**: Indicação visual quando análise está pronta

### 6. Geração de Gabaritos Personalizados

- Upload de CSV com dados dos alunos (Nome, Turma, Matrícula)
- Preview antes de gerar
- Geração automática de PDFs com dados pré-preenchidos
- Suporte a lotes grandes (divide automaticamente em múltiplos PDFs)

### 7. Correção e Análise

- Configuração de gabarito oficial
- Cálculo automático de notas e acertos
- Templates pré-configurados para diferentes tipos de prova:
  - ENEM Completo (180 questões)
  - ENEM Dia 1/Dia 2 (90 questões cada)
  - Vestibular FUVEST (90 questões)
  - Vestibular UNICAMP (72 questões)
  - Prova Bimestral (20 questões)
  - Simulado (45 questões)
  - Personalizado (configurável)

### 8. Exportação

- Exportação completa para Excel
- Múltiplas planilhas (Alunos, Gabarito, Estatísticas, Análise por Questão)
- Dados editáveis e formatados
- Exportação de análise pedagógica em PDF

## 🛠️ Tecnologias

### Frontend
- **React 18** - Framework UI
- **TypeScript** - Tipagem estática
- **Vite** - Build tool e dev server
- **Tailwind CSS** - Estilização
- **Shadcn/UI** - Componentes UI (Card, Table, Tabs, Button, Dialog, etc.)
- **Recharts** - Gráficos e visualizações
- **PDF.js** - Preview de PDFs
- **React Dropzone** - Upload de arquivos

### Backend
- **Express.js** - Framework web
- **TypeScript** - Tipagem estática
- **pdf-lib** - Manipulação de PDFs
- **Sharp** - Processamento de imagens
- **Multer** - Upload de arquivos
- **ExcelJS** - Geração de Excel
- **OpenAI API** - Integração com ChatGPT Vision e Assistant API

### Serviços Python

#### Python OMR Service
- **OpenCV** - Processamento de imagem e detecção de bolhas
- **PIL/Pillow** - Manipulação de imagens
- **pdf2image** - Conversão PDF para imagem
- **Flask** - API REST para OMR

#### Python TRI Service
- **Pandas** - Processamento de dados
- **NumPy** - Cálculos numéricos
- **Flask** - API REST para cálculo TRI

#### OCR Service (Opcional)
- **DeepSeek-OCR** - Reconhecimento de texto em imagens

## 📁 Estrutura do Projeto

```
gabaritosxtri/
├── client/                      # Frontend React
│   ├── src/
│   │   ├── components/ui/      # Componentes Shadcn/UI
│   │   ├── pages/              # Páginas da aplicação
│   │   │   └── home.tsx        # Página principal
│   │   ├── hooks/              # React hooks customizados
│   │   └── lib/                # Utilitários
│   └── index.html
├── server/                      # Backend Express
│   ├── index.ts                # Servidor principal
│   ├── routes.ts               # API endpoints
│   ├── omr.ts                  # Processamento OMR TypeScript (fallback)
│   ├── chatgptOMR.ts           # Integração ChatGPT Vision
│   ├── deepseekOCR.ts          # Integração DeepSeek-OCR
│   ├── reports/
│   │   └── excelExporter.ts    # Exportação Excel
│   └── vite.ts                 # Configuração Vite dev
├── python_omr_service/          # Serviço Python OMR
│   ├── app.py                  # API Flask OMR
│   └── requirements.txt
├── python_tri_service/          # Serviço Python TRI
│   ├── tri_v2_producao.py     # Cálculo TRI V2
│   └── requirements.txt
├── ocr_service/                 # Serviço OCR (opcional)
│   └── deepseek_ocr_api.py
├── shared/                      # Código compartilhado
│   └── schema.ts               # Schemas Zod e tipos TypeScript
├── script/                      # Scripts de build
│   └── build.ts                # Build para produção
├── tri/                         # Dados históricos TRI
│   └── TRI ENEM DE 2009 A 2023 MIN MED E MAX.csv
└── attached_assets/            # Assets (PDFs, imagens, templates)
```

## 🚀 Instalação e Uso

### Pré-requisitos
- Node.js 18+
- Python 3.9+
- npm ou yarn
- (Opcional) `pdftoppm` para conversão de PDF (ou usa Sharp como fallback)

### Instalação

```bash
# Clone o repositório
git clone https://github.com/xtribr/gabaritosxtri.git
cd gabaritosxtri

# Instale as dependências do Node.js
npm install

# Configure o ambiente Python OMR
cd python_omr_service
python -m venv venv
source venv/bin/activate  # No Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ..

# Configure o ambiente Python TRI
cd python_tri_service
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..

# (Opcional) Configure o serviço OCR
cd ocr_service
# Siga as instruções no README do serviço
cd ..
```

### Configuração de Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
# Servidor Node.js
PORT=8080
NODE_ENV=development

# OpenAI API (OBRIGATÓRIO para validação de qualidade)
OPENAI_API_KEY=sk-...
OPENAI_ASSISTANT_ID=asst_...
CHATGPT_MODEL=gpt-4o-mini

# URLs dos Serviços Python
PYTHON_OMR_SERVICE_URL=http://localhost:5000
PYTHON_TRI_SERVICE_URL=http://localhost:5001
OCR_SERVICE_URL=http://localhost:5002
```

**⚠️ IMPORTANTE**: A `OPENAI_API_KEY` é **OBRIGATÓRIA** para o funcionamento do sistema. A validação de qualidade (ChatGPT) é obrigatória e o processamento será bloqueado se a chave não estiver configurada.

### Desenvolvimento

```bash
# Inicia o servidor (recomendado)
./run.sh

# Ou inicie manualmente:

# Terminal 1: Servidor Node.js
npm run dev

# Terminal 2: Serviço Python OMR
cd python_omr_service
source venv/bin/activate
python app.py

# Terminal 3: Serviço Python TRI
cd python_tri_service
source venv/bin/activate
python tri_v2_producao.py

# Terminal 4: Serviço OCR (opcional)
cd ocr_service
./start_ocr_service.sh
```

A aplicação estará disponível em `http://localhost:8080`

### Produção

```bash
# Build para produção
npm run build

# Inicia servidor de produção
npm start
```

## 📡 API Endpoints

### Processamento de PDF
- `POST /api/process-pdf` - Inicia processamento de PDF
  - Body: `{ pdf: File, enableOcr: boolean }`
  - ChatGPT é sempre habilitado (obrigatório)
- `GET /api/process-pdf/:jobId/status` - Status do processamento
- `GET /api/process-pdf/:jobId/results` - Resultados do processamento

### Cálculo TRI
- `POST /api/calculate-tri-v2` - Calcula notas TRI usando serviço Python
- `GET /api/tri-historical-data` - Dados históricos TRI do ENEM

### Análise Pedagógica
- `POST /api/analise-enem-tri` - Gera análise pedagógica com OpenAI Assistant API

### Geração de PDFs
- `POST /api/generate-pdfs` - Gera PDFs personalizados a partir de CSV
- `GET /api/download-pdf/:batchId/:fileIndex` - Download de PDF gerado
- `POST /api/preview-csv` - Preview e validação de CSV

### Exportação
- `POST /api/export-excel` - Exporta dados para Excel

### Utilitários
- `GET /api/health` - Health check do servidor

## 🎨 Interface

A interface foi desenvolvida seguindo princípios de design moderno e profissional:

- **Design Limpo**: Layout inspirado em dashboards profissionais
- **Cores por Área**: 
  - 🔵 Azul: Linguagens (LC)
  - 🟢 Verde: Humanas (CH)
  - 🟣 Roxo: Natureza (CN)
  - 🟠 Laranja: Matemática (MT)
- **Feedback Visual**: 
  - Emojis expressivos para desempenho dos alunos (😢 😐 😊)
  - Cores de dificuldade nas questões
  - Progress bars e indicadores visuais
- **Responsivo**: Funciona em desktop, tablet e mobile
- **Acessibilidade**: Componentes acessíveis e navegação por teclado

## 📊 Processamento OMR

O sistema utiliza análise de imagem avançada para detectar bolhas marcadas:

- **Template Oficial ENEM**: Coordenadas calibradas para gabarito oficial
- **Alinhamento Automático**: Correção de rotação usando marcas de registro
- **Thresholds Configuráveis**: Para diferentes condições de escaneamento
- **Cálculo de Confiança**: Por resposta e por página
- **Validação ChatGPT**: Correção automática de erros de detecção

### Calibração OMR

⚠️ **IMPORTANTE**: A calibração do OMR é crítica e **NUNCA** deve ser alterada. Alterações nas configurações de DPI, tamanho de imagem, resampling, autocontrast ou alinhamento podem quebrar a detecção.

## 🔧 Configuração

### Variáveis de Ambiente

```env
# Servidor
PORT=8080
NODE_ENV=development

# OpenAI (OBRIGATÓRIO)
OPENAI_API_KEY=sk-...
OPENAI_ASSISTANT_ID=asst_...
CHATGPT_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1

# Serviços Python
PYTHON_OMR_SERVICE_URL=http://localhost:5000
PYTHON_TRI_SERVICE_URL=http://localhost:5001
OCR_SERVICE_URL=http://localhost:5002

# Configurações OMR
USE_PYTHON_OMR=true
```

### Templates de Prova

Os templates podem ser configurados em `shared/schema.ts`. O sistema inclui templates pré-configurados para:

- ENEM (completo e por dia)
- Vestibulares (FUVEST, UNICAMP)
- Provas escolares (bimestral, simulado)
- Personalizado (configurável)

## 📝 Formato dos Arquivos de Entrada

### CSV para Geração de Gabaritos Personalizados

```csv
NOME;TURMA;MATRICULA
João Silva;3º A;12345
Maria Santos;3º B;12346
```

**Colunas Obrigatórias:**
- `NOME` (ou `NOME DO ALUNO`, `NOME_COMPLETO`): Nome completo do aluno
- `TURMA` (ou `SALA`, `CLASSE`): Turma/sala do aluno
- `MATRICULA` (ou `MATRÍCULA`, `ID`, `CODIGO`): Matrícula ou código único do aluno

### CSV para Importação de Gabarito Oficial

```csv
NR QUESTÃO;GABARITO;CONTEÚDO
1;A;Matemática - Álgebra
2;B;Matemática - Geometria
3;C;Linguagens - Literatura
```

**Colunas Obrigatórias:**
- `NR QUESTÃO`: Número da questão (1, 2, 3...)
- `GABARITO`: Letra da resposta correta (A, B, C, D, E)
- `CONTEÚDO`: Conteúdo/assunto da questão (opcional mas recomendado)

### CSV de Dados TRI Históricos

O sistema utiliza um arquivo CSV com dados históricos de TRI do ENEM (2009-2023) localizado em `tri/TRI ENEM DE 2009 A 2023 MIN MED E MAX.csv`.

**⚠️ IMPORTANTE - Segurança e LGPD:**
- **NUNCA** commite arquivos CSV ou Excel com dados reais de alunos no repositório
- O arquivo `.gitignore` está configurado para ignorar `*.csv` e `*.xlsx`
- Dados de alunos são informações sensíveis protegidas pela LGPD
- Use apenas dados de exemplo ou anonimizados para testes

## 🐛 Troubleshooting

### ChatGPT não funciona
- Verifique se `OPENAI_API_KEY` está configurada no `.env`
- Verifique se `OPENAI_ASSISTANT_ID` está configurada
- A validação de qualidade é obrigatória - o processamento será bloqueado sem a chave

### OMR não detecta bolhas
- Verifique se o serviço Python OMR está rodando
- Não altere a calibração do OMR (DPI, tamanho, resampling, etc.)
- Verifique a qualidade do escaneamento (ChatGPT detectará problemas)

### PDF não processa
- Verifique se o PDF não está protegido ou criptografado
- Verifique os logs do servidor para erros de qualidade
- ChatGPT pode bloquear processamento se qualidade for crítica

### Erro de memória
- Para lotes muito grandes, o sistema divide automaticamente em múltiplos PDFs
- Considere processar PDFs menores separadamente

## 📄 Licença

Este projeto está sob a licença MIT.

## 👨‍💻 Desenvolvido por

**XTRI - EdTech em Natal/RN**

Especialista em ENEM e TRI, desenvolvendo soluções educacionais com dados reais.

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📞 Suporte

Para questões e suporte, abra uma issue no GitHub.

---

⭐ Se este projeto foi útil, considere dar uma estrela!
