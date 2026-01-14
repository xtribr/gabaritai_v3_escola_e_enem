# Testing Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar testes unitários e de integração ao GabaritAI sem quebrar o código em produção.

**Architecture:** Vitest para testes unitários (funções puras), Supertest para testes de API com mocks dos serviços Python. Testes rodam isoladamente sem tocar em produção.

**Tech Stack:** Vitest, Supertest, MSW (Mock Service Worker), @faker-js/faker

---

## Fase 1: Configuração do Framework de Testes

### Task 1: Instalar dependências de teste

**Files:**
- Modify: `package.json`

**Step 1: Instalar Vitest e dependências**

```bash
npm install -D vitest @vitest/coverage-v8 supertest @types/supertest msw @faker-js/faker
```

**Step 2: Verificar instalação**

```bash
npx vitest --version
```
Expected: Versão do Vitest instalada (ex: `vitest/3.x.x`)

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add testing dependencies (vitest, supertest, msw)"
```

---

### Task 2: Configurar Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (adicionar scripts)

**Step 1: Criar arquivo de configuração do Vitest**

Criar `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['node_modules', 'dist', 'python_*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules', 'dist', 'python_*', '**/*.test.ts', '**/*.spec.ts'],
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
      '@': path.resolve(__dirname, './client/src'),
    },
  },
});
```

**Step 2: Adicionar scripts ao package.json**

Adicionar em `scripts`:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

**Step 3: Verificar configuração**

```bash
npm run test
```
Expected: "No test files found" (ainda não temos testes)

**Step 4: Commit**

```bash
git add vitest.config.ts package.json
git commit -m "chore: configure vitest with path aliases"
```

---

## Fase 2: Testes Unitários - Calculadoras (CRÍTICO)

### Task 3: Testes do TCT Calculator

**Files:**
- Create: `server/src/calculations/__tests__/tctCalculator.test.ts`
- Reference: `server/src/calculations/tctCalculator.ts`

**Step 1: Criar estrutura de diretório e arquivo de teste**

```bash
mkdir -p server/src/calculations/__tests__
```

**Step 2: Escrever testes básicos do TCT**

Criar `server/src/calculations/__tests__/tctCalculator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TCTCalculator } from '../tctCalculator';

describe('TCTCalculator', () => {
  describe('calculate', () => {
    it('should calculate 100% score when all answers are correct', () => {
      const students = [
        {
          student_number: '001',
          answers: ['A', 'B', 'C', 'D', 'E'],
        },
      ];
      const answerKey = ['A', 'B', 'C', 'D', 'E'];

      const results = TCTCalculator.calculate(students, answerKey);

      expect(results).toHaveLength(1);
      expect(results[0].acertos).toBe(5);
      expect(results[0].erros).toBe(0);
      expect(results[0].nota).toBe(10);
    });

    it('should calculate 0% score when all answers are wrong', () => {
      const students = [
        {
          student_number: '001',
          answers: ['B', 'C', 'D', 'E', 'A'],
        },
      ];
      const answerKey = ['A', 'B', 'C', 'D', 'E'];

      const results = TCTCalculator.calculate(students, answerKey);

      expect(results).toHaveLength(1);
      expect(results[0].acertos).toBe(0);
      expect(results[0].erros).toBe(5);
      expect(results[0].nota).toBe(0);
    });

    it('should calculate partial score correctly', () => {
      const students = [
        {
          student_number: '001',
          answers: ['A', 'B', 'X', 'X', 'X'], // 2 certas, 3 erradas
        },
      ];
      const answerKey = ['A', 'B', 'C', 'D', 'E'];

      const results = TCTCalculator.calculate(students, answerKey);

      expect(results[0].acertos).toBe(2);
      expect(results[0].erros).toBe(3);
      expect(results[0].nota).toBe(4); // 2/5 * 10 = 4
    });

    it('should handle blank answers as errors', () => {
      const students = [
        {
          student_number: '001',
          answers: ['A', '', 'C', '', 'E'], // 3 certas, 2 em branco
        },
      ];
      const answerKey = ['A', 'B', 'C', 'D', 'E'];

      const results = TCTCalculator.calculate(students, answerKey);

      expect(results[0].acertos).toBe(3);
      expect(results[0].brancos).toBe(2);
    });

    it('should be case-insensitive', () => {
      const students = [
        {
          student_number: '001',
          answers: ['a', 'b', 'c'],
        },
      ];
      const answerKey = ['A', 'B', 'C'];

      const results = TCTCalculator.calculate(students, answerKey);

      expect(results[0].acertos).toBe(3);
    });

    it('should handle multiple students', () => {
      const students = [
        { student_number: '001', answers: ['A', 'B', 'C'] },
        { student_number: '002', answers: ['A', 'X', 'X'] },
        { student_number: '003', answers: ['X', 'X', 'X'] },
      ];
      const answerKey = ['A', 'B', 'C'];

      const results = TCTCalculator.calculate(students, answerKey);

      expect(results).toHaveLength(3);
      expect(results[0].acertos).toBe(3);
      expect(results[1].acertos).toBe(1);
      expect(results[2].acertos).toBe(0);
    });

    it('should calculate by area when areas are provided', () => {
      const students = [
        {
          student_number: '001',
          answers: ['A', 'B', 'C', 'D', 'E', 'A', 'B', 'C', 'D', 'E'],
        },
      ];
      const answerKey = ['A', 'B', 'C', 'D', 'E', 'A', 'B', 'C', 'D', 'E'];
      const areas = [
        { name: 'Area1', startQuestion: 1, endQuestion: 5 },
        { name: 'Area2', startQuestion: 6, endQuestion: 10 },
      ];

      const results = TCTCalculator.calculate(students, answerKey, areas);

      expect(results[0].areas).toBeDefined();
      expect(results[0].areas?.Area1?.acertos).toBe(5);
      expect(results[0].areas?.Area2?.acertos).toBe(5);
    });
  });
});
```

**Step 3: Rodar testes para verificar que passam**

```bash
npm run test server/src/calculations/__tests__/tctCalculator.test.ts
```
Expected: Todos os testes passam (8 testes)

**Step 4: Commit**

```bash
git add server/src/calculations/__tests__/tctCalculator.test.ts
git commit -m "test: add TCT calculator unit tests"
```

---

### Task 4: Testes do Question Stats Processor

**Files:**
- Create: `server/src/processors/__tests__/questionStatsProcessor.test.ts`
- Reference: `server/src/processors/questionStatsProcessor.ts`

**Step 1: Criar estrutura de diretório**

```bash
mkdir -p server/src/processors/__tests__
```

**Step 2: Escrever testes do Question Stats Processor**

Criar `server/src/processors/__tests__/questionStatsProcessor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { QuestionStatsProcessor } from '../questionStatsProcessor';

describe('QuestionStatsProcessor', () => {
  describe('calculateQuestionStats', () => {
    it('should calculate 100% correct rate when all students answer correctly', () => {
      const students = [
        { student_number: '001', answers: ['A', 'B', 'C'] },
        { student_number: '002', answers: ['A', 'B', 'C'] },
      ];
      const answerKey = ['A', 'B', 'C'];

      const stats = QuestionStatsProcessor.calculateQuestionStats(students, answerKey);

      expect(stats).toHaveLength(3);
      expect(stats[0].percentCorrect).toBe(100);
      expect(stats[1].percentCorrect).toBe(100);
      expect(stats[2].percentCorrect).toBe(100);
    });

    it('should calculate 50% when half students answer correctly', () => {
      const students = [
        { student_number: '001', answers: ['A'] },
        { student_number: '002', answers: ['B'] },
      ];
      const answerKey = ['A'];

      const stats = QuestionStatsProcessor.calculateQuestionStats(students, answerKey);

      expect(stats[0].percentCorrect).toBe(50);
    });

    it('should track answer distribution', () => {
      const students = [
        { student_number: '001', answers: ['A'] },
        { student_number: '002', answers: ['A'] },
        { student_number: '003', answers: ['B'] },
        { student_number: '004', answers: ['C'] },
      ];
      const answerKey = ['A'];

      const stats = QuestionStatsProcessor.calculateQuestionStats(students, answerKey);

      expect(stats[0].distribution.A).toBe(2);
      expect(stats[0].distribution.B).toBe(1);
      expect(stats[0].distribution.C).toBe(1);
    });

    it('should filter by question range', () => {
      const students = [
        { student_number: '001', answers: ['A', 'B', 'C', 'D', 'E'] },
      ];
      const answerKey = ['A', 'B', 'C', 'D', 'E'];

      const stats = QuestionStatsProcessor.calculateQuestionStats(
        students,
        answerKey,
        2, // startQuestion
        4  // endQuestion
      );

      expect(stats).toHaveLength(3); // Questions 2, 3, 4
    });

    it('should handle empty answers as blank', () => {
      const students = [
        { student_number: '001', answers: ['', 'B', ''] },
      ];
      const answerKey = ['A', 'B', 'C'];

      const stats = QuestionStatsProcessor.calculateQuestionStats(students, answerKey);

      expect(stats[0].blanks).toBe(1);
      expect(stats[2].blanks).toBe(1);
    });
  });
});
```

**Step 3: Rodar testes**

```bash
npm run test server/src/processors/__tests__/questionStatsProcessor.test.ts
```
Expected: Todos os testes passam (5 testes)

**Step 4: Commit**

```bash
git add server/src/processors/__tests__/questionStatsProcessor.test.ts
git commit -m "test: add question stats processor unit tests"
```

---

## Fase 3: Testes de Validação de Schema

### Task 5: Testes dos Zod Schemas

**Files:**
- Create: `shared/__tests__/schema.test.ts`
- Reference: `shared/schema.ts`

**Step 1: Criar diretório de testes**

```bash
mkdir -p shared/__tests__
```

**Step 2: Escrever testes de validação de schema**

Criar `shared/__tests__/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  studentDataSchema,
  answerKeySchema,
  // Adicionar outros schemas conforme necessário
} from '../schema';

describe('Schema Validation', () => {
  describe('studentDataSchema', () => {
    it('should accept valid student data', () => {
      const validStudent = {
        student_number: '12345',
        answers: ['A', 'B', 'C', 'D', 'E'],
      };

      const result = studentDataSchema.safeParse(validStudent);
      expect(result.success).toBe(true);
    });

    it('should reject student without student_number', () => {
      const invalidStudent = {
        answers: ['A', 'B', 'C'],
      };

      const result = studentDataSchema.safeParse(invalidStudent);
      expect(result.success).toBe(false);
    });

    it('should reject student without answers', () => {
      const invalidStudent = {
        student_number: '12345',
      };

      const result = studentDataSchema.safeParse(invalidStudent);
      expect(result.success).toBe(false);
    });

    it('should accept student with optional fields', () => {
      const studentWithOptionals = {
        student_number: '12345',
        answers: ['A', 'B'],
        name: 'João Silva',
        turma: '3A',
      };

      const result = studentDataSchema.safeParse(studentWithOptionals);
      expect(result.success).toBe(true);
    });
  });

  describe('answerKeySchema', () => {
    it('should accept valid answer key', () => {
      const validKey = ['A', 'B', 'C', 'D', 'E'];

      const result = answerKeySchema.safeParse(validKey);
      expect(result.success).toBe(true);
    });

    it('should accept single-letter answers', () => {
      const validKey = ['A', 'B', 'C', 'D', 'E', 'X']; // X pode ser anulada

      const result = answerKeySchema.safeParse(validKey);
      expect(result.success).toBe(true);
    });

    it('should reject empty array', () => {
      const result = answerKeySchema.safeParse([]);
      expect(result.success).toBe(false);
    });
  });
});
```

**Step 3: Rodar testes**

```bash
npm run test shared/__tests__/schema.test.ts
```
Expected: Todos os testes passam

**Step 4: Commit**

```bash
git add shared/__tests__/schema.test.ts
git commit -m "test: add zod schema validation tests"
```

---

## Fase 4: Testes de Integração da API

### Task 6: Setup de testes de API com Supertest

**Files:**
- Create: `server/__tests__/setup.ts`
- Create: `server/__tests__/api/health.test.ts`

**Step 1: Criar setup de testes**

Criar `server/__tests__/setup.ts`:

```typescript
import { beforeAll, afterAll, vi } from 'vitest';

// Mock environment variables for tests
beforeAll(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-service-key');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// Mock Supabase client
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
    },
  })),
}));
```

**Step 2: Criar teste básico de health check**

Criar `server/__tests__/api/health.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

// Criar uma versão simplificada do app para testes
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Health check endpoint (copiar do routes.ts)
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}

describe('API Health Check', () => {
  const app = createTestApp();

  it('should return 200 OK on health check', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toBeDefined();
  });
});
```

**Step 3: Rodar teste de API**

```bash
npm run test server/__tests__/api/health.test.ts
```
Expected: Teste passa

**Step 4: Commit**

```bash
git add server/__tests__/setup.ts server/__tests__/api/health.test.ts
git commit -m "test: add API test setup with supertest"
```

---

### Task 7: Testes de Integração do Score Calculation

**Files:**
- Create: `server/__tests__/api/calculate-scores.test.ts`

**Step 1: Escrever testes de integração do cálculo de scores**

Criar `server/__tests__/api/calculate-scores.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock das dependências
vi.mock('../../lib/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = { id: 'test-user', role: 'super_admin' };
    next();
  },
  requireRole: () => (req: any, res: any, next: any) => next(),
}));

// Criar app de teste com endpoint de cálculo
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Importar TCTCalculator
  const { TCTCalculator } = require('../../src/calculations/tctCalculator');

  app.post('/api/calculate-tct', (req, res) => {
    try {
      const { students, answerKey, areas } = req.body;

      if (!students || !answerKey) {
        return res.status(400).json({ error: 'students and answerKey are required' });
      }

      const results = TCTCalculator.calculate(students, answerKey, areas);
      res.json({ success: true, results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return app;
}

describe('Score Calculation API', () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/calculate-tct', () => {
    it('should calculate TCT scores for valid input', async () => {
      const payload = {
        students: [
          { student_number: '001', answers: ['A', 'B', 'C', 'D', 'E'] },
          { student_number: '002', answers: ['A', 'B', 'X', 'X', 'X'] },
        ],
        answerKey: ['A', 'B', 'C', 'D', 'E'],
      };

      const response = await request(app)
        .post('/api/calculate-tct')
        .send(payload)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0].acertos).toBe(5);
      expect(response.body.results[1].acertos).toBe(2);
    });

    it('should return 400 when students is missing', async () => {
      const payload = {
        answerKey: ['A', 'B', 'C'],
      };

      const response = await request(app)
        .post('/api/calculate-tct')
        .send(payload)
        .expect(400);

      expect(response.body.error).toContain('required');
    });

    it('should return 400 when answerKey is missing', async () => {
      const payload = {
        students: [{ student_number: '001', answers: ['A'] }],
      };

      const response = await request(app)
        .post('/api/calculate-tct')
        .send(payload)
        .expect(400);

      expect(response.body.error).toContain('required');
    });

    it('should calculate with areas when provided', async () => {
      const payload = {
        students: [
          { student_number: '001', answers: ['A', 'B', 'C', 'D', 'E', 'A', 'B', 'C', 'D', 'E'] },
        ],
        answerKey: ['A', 'B', 'C', 'D', 'E', 'A', 'B', 'C', 'D', 'E'],
        areas: [
          { name: 'Linguagens', startQuestion: 1, endQuestion: 5 },
          { name: 'Matemática', startQuestion: 6, endQuestion: 10 },
        ],
      };

      const response = await request(app)
        .post('/api/calculate-tct')
        .send(payload)
        .expect(200);

      expect(response.body.results[0].areas).toBeDefined();
      expect(response.body.results[0].areas.Linguagens).toBeDefined();
      expect(response.body.results[0].areas.Matemática).toBeDefined();
    });
  });
});
```

**Step 2: Rodar testes**

```bash
npm run test server/__tests__/api/calculate-scores.test.ts
```
Expected: Todos os testes passam (4 testes)

**Step 3: Commit**

```bash
git add server/__tests__/api/calculate-scores.test.ts
git commit -m "test: add score calculation API integration tests"
```

---

## Fase 5: Script de CI e Documentação

### Task 8: Adicionar script de CI para GitHub Actions

**Files:**
- Create: `.github/workflows/test.yml`

**Step 1: Criar workflow de CI**

Criar `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [main, amazing-lamport]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run TypeScript check
        run: npm run check

      - name: Run tests
        run: npm run test

      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
```

**Step 2: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/test.yml
git commit -m "ci: add GitHub Actions workflow for tests"
```

---

### Task 9: Rodar todos os testes e verificar

**Step 1: Rodar suite completa de testes**

```bash
npm run test
```
Expected: Todos os testes passam

**Step 2: Rodar com coverage**

```bash
npm run test:coverage
```
Expected: Relatório de coverage gerado em `coverage/`

**Step 3: Commit final**

```bash
git add -A
git commit -m "test: complete testing infrastructure setup"
```

---

## Resumo dos Arquivos Criados

| Arquivo | Propósito |
|---------|-----------|
| `vitest.config.ts` | Configuração do framework de testes |
| `server/src/calculations/__tests__/tctCalculator.test.ts` | Testes unitários do TCT |
| `server/src/processors/__tests__/questionStatsProcessor.test.ts` | Testes do processador de estatísticas |
| `shared/__tests__/schema.test.ts` | Testes de validação de schemas |
| `server/__tests__/setup.ts` | Setup global de testes |
| `server/__tests__/api/health.test.ts` | Teste de health check |
| `server/__tests__/api/calculate-scores.test.ts` | Testes de integração de scores |
| `.github/workflows/test.yml` | CI/CD para rodar testes |

---

## Próximos Passos (Fora deste Plano)

1. **Adicionar testes do TRI Calculator** - Mais complexo, requer mock de dados históricos
2. **Testes E2E com Playwright** - Testar fluxos completos do usuário
3. **Mock do serviço Python OMR** - Testar pipeline de PDF sem serviço externo
4. **Testes de autenticação** - Testar middleware de auth com tokens JWT mockados

---

## Notas de Segurança

- **Testes nunca tocam em produção** - Usam mocks de Supabase
- **Dados de teste são fictícios** - Usar faker para gerar dados
- **CI roda em ambiente isolado** - GitHub Actions com secrets separados
- **Coverage report não expõe código** - Apenas métricas
