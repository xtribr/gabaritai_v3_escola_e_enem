import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { TCTCalculator } from '../../src/calculations/tctCalculator';

// Helper para criar StudentData válido
function createStudent(id: string, answers: string[]) {
  return {
    id,
    studentNumber: id,
    studentName: `Student ${id}`,
    answers,
    pageNumber: 1,
  };
}

// Criar app de teste com endpoint de cálculo
function createTestApp() {
  const app = express();
  app.use(express.json());

  app.post('/api/calculate-tct', (req, res) => {
    try {
      const { students, answerKey, areas } = req.body;

      if (!students || !answerKey) {
        return res.status(400).json({ error: 'students and answerKey are required' });
      }

      if (!Array.isArray(students) || students.length === 0) {
        return res.status(400).json({ error: 'students must be a non-empty array' });
      }

      if (!Array.isArray(answerKey) || answerKey.length === 0) {
        return res.status(400).json({ error: 'answerKey must be a non-empty array' });
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
          createStudent('001', ['A', 'B', 'C', 'D', 'E']),
          createStudent('002', ['A', 'B', 'X', 'X', 'X']),
        ],
        answerKey: ['A', 'B', 'C', 'D', 'E'],
      };

      const response = await request(app)
        .post('/api/calculate-tct')
        .send(payload)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0].averageScore).toBe(10); // 5/5 = 100%
      expect(response.body.results[1].averageScore).toBe(4);  // 2/5 = 40%
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
        students: [createStudent('001', ['A'])],
      };

      const response = await request(app)
        .post('/api/calculate-tct')
        .send(payload)
        .expect(400);

      expect(response.body.error).toContain('required');
    });

    it('should return 400 for empty students array', async () => {
      const payload = {
        students: [],
        answerKey: ['A', 'B', 'C'],
      };

      const response = await request(app)
        .post('/api/calculate-tct')
        .send(payload)
        .expect(400);

      expect(response.body.error).toContain('non-empty');
    });

    it('should return 400 for empty answerKey array', async () => {
      const payload = {
        students: [createStudent('001', ['A'])],
        answerKey: [],
      };

      const response = await request(app)
        .post('/api/calculate-tct')
        .send(payload)
        .expect(400);

      expect(response.body.error).toContain('non-empty');
    });

    it('should calculate with areas when provided', async () => {
      const payload = {
        students: [
          createStudent('001', ['A', 'B', 'C', 'D', 'E', 'A', 'B', 'C', 'D', 'E']),
        ],
        answerKey: ['A', 'B', 'C', 'D', 'E', 'A', 'B', 'C', 'D', 'E'],
        areas: [
          { area: 'Linguagens', start: 1, end: 5 },
          { area: 'Matemática', start: 6, end: 10 },
        ],
      };

      const response = await request(app)
        .post('/api/calculate-tct')
        .send(payload)
        .expect(200);

      expect(response.body.results[0].areaScores).toBeDefined();
      expect(response.body.results[0].areaScores.Linguagens).toBe(10);
      expect(response.body.results[0].areaScores.Matemática).toBe(10);
    });

    it('should handle large batch of students', async () => {
      const students = Array.from({ length: 100 }, (_, i) =>
        createStudent(`${i + 1}`.padStart(3, '0'), ['A', 'B', 'C', 'D', 'E'])
      );

      const payload = {
        students,
        answerKey: ['A', 'B', 'C', 'D', 'E'],
      };

      const response = await request(app)
        .post('/api/calculate-tct')
        .send(payload)
        .expect(200);

      expect(response.body.results).toHaveLength(100);
      expect(response.body.results.every((r: any) => r.averageScore === 10)).toBe(true);
    });
  });
});
