import { describe, it, expect } from 'vitest';
import {
  studentDataSchema,
  answerKeySchema,
  examTemplateSchema,
  questionContentSchema,
} from '../schema';

describe('Schema Validation', () => {
  describe('studentDataSchema', () => {
    it('should accept valid student data with required fields', () => {
      const validStudent = {
        id: 'student-001',
        studentNumber: '12345',
        studentName: 'Joao Silva',
        answers: ['A', 'B', 'C', 'D', 'E'],
        pageNumber: 1,
      };

      const result = studentDataSchema.safeParse(validStudent);
      expect(result.success).toBe(true);
    });

    it('should accept student with optional turma field', () => {
      const studentWithTurma = {
        id: 'student-001',
        studentNumber: '12345',
        studentName: 'Joao Silva',
        answers: ['A', 'B'],
        pageNumber: 1,
        turma: '3A',
      };

      const result = studentDataSchema.safeParse(studentWithTurma);
      expect(result.success).toBe(true);
    });

    it('should reject student without id', () => {
      const invalidStudent = {
        studentNumber: '12345',
        studentName: 'Joao Silva',
        answers: ['A'],
        pageNumber: 1,
      };

      const result = studentDataSchema.safeParse(invalidStudent);
      expect(result.success).toBe(false);
    });

    it('should reject student without studentNumber', () => {
      const invalidStudent = {
        id: 'student-001',
        studentName: 'Joao Silva',
        answers: ['A'],
        pageNumber: 1,
      };

      const result = studentDataSchema.safeParse(invalidStudent);
      expect(result.success).toBe(false);
    });

    it('should reject student without answers array', () => {
      const invalidStudent = {
        id: 'student-001',
        studentNumber: '12345',
        studentName: 'Joao Silva',
        pageNumber: 1,
      };

      const result = studentDataSchema.safeParse(invalidStudent);
      expect(result.success).toBe(false);
    });

    it('should reject student without pageNumber', () => {
      const invalidStudent = {
        id: 'student-001',
        studentNumber: '12345',
        studentName: 'Joao Silva',
        answers: ['A'],
      };

      const result = studentDataSchema.safeParse(invalidStudent);
      expect(result.success).toBe(false);
    });

    it('should accept empty answers array', () => {
      const studentWithEmptyAnswers = {
        id: 'student-001',
        studentNumber: '12345',
        studentName: 'Joao Silva',
        answers: [],
        pageNumber: 1,
      };

      const result = studentDataSchema.safeParse(studentWithEmptyAnswers);
      expect(result.success).toBe(true);
    });
  });

  describe('answerKeySchema', () => {
    it('should accept valid answer key', () => {
      const validKey = {
        id: 'key-001',
        name: 'Prova de Matematica',
        answers: ['A', 'B', 'C', 'D', 'E'],
        createdAt: '2024-01-15T10:00:00Z',
      };

      const result = answerKeySchema.safeParse(validKey);
      expect(result.success).toBe(true);
    });

    it('should reject answer key without id', () => {
      const invalidKey = {
        name: 'Prova de Matematica',
        answers: ['A', 'B', 'C'],
        createdAt: '2024-01-15T10:00:00Z',
      };

      const result = answerKeySchema.safeParse(invalidKey);
      expect(result.success).toBe(false);
    });

    it('should reject answer key without name', () => {
      const invalidKey = {
        id: 'key-001',
        answers: ['A', 'B', 'C'],
        createdAt: '2024-01-15T10:00:00Z',
      };

      const result = answerKeySchema.safeParse(invalidKey);
      expect(result.success).toBe(false);
    });

    it('should reject answer key without answers', () => {
      const invalidKey = {
        id: 'key-001',
        name: 'Prova de Matematica',
        createdAt: '2024-01-15T10:00:00Z',
      };

      const result = answerKeySchema.safeParse(invalidKey);
      expect(result.success).toBe(false);
    });
  });

  describe('examTemplateSchema', () => {
    it('should accept valid exam template', () => {
      const validTemplate = {
        id: 'template-001',
        name: 'ENEM',
        totalQuestions: 180,
        validAnswers: ['A', 'B', 'C', 'D', 'E'],
        passingScore: 60,
        createdAt: '2024-01-15T10:00:00Z',
      };

      const result = examTemplateSchema.safeParse(validTemplate);
      expect(result.success).toBe(true);
    });

    it('should accept template with optional description', () => {
      const templateWithDesc = {
        id: 'template-001',
        name: 'ENEM',
        description: 'Exame Nacional do Ensino Medio',
        totalQuestions: 180,
        validAnswers: ['A', 'B', 'C', 'D', 'E'],
        passingScore: 60,
        createdAt: '2024-01-15T10:00:00Z',
      };

      const result = examTemplateSchema.safeParse(templateWithDesc);
      expect(result.success).toBe(true);
    });

    it('should reject template without totalQuestions', () => {
      const invalidTemplate = {
        id: 'template-001',
        name: 'ENEM',
        validAnswers: ['A', 'B', 'C', 'D', 'E'],
        passingScore: 60,
        createdAt: '2024-01-15T10:00:00Z',
      };

      const result = examTemplateSchema.safeParse(invalidTemplate);
      expect(result.success).toBe(false);
    });
  });

  describe('questionContentSchema', () => {
    it('rejects invalid question number (negative)', () => {
      const result = questionContentSchema.safeParse({
        questionNumber: -1,
        answer: 'A',
        content: 'Matematica',
      });

      expect(result.success).toBe(false);
    });

    it('rejects invalid question number (zero)', () => {
      const result = questionContentSchema.safeParse({
        questionNumber: 0,
        answer: 'A',
        content: 'Matematica',
      });

      expect(result.success).toBe(false);
    });

    it('rejects invalid answer (not A-E)', () => {
      const result = questionContentSchema.safeParse({
        questionNumber: 1,
        answer: 'Z',
        content: 'Matematica',
      });

      expect(result.success).toBe(false);
    });

    it('rejects empty content', () => {
      const result = questionContentSchema.safeParse({
        questionNumber: 1,
        answer: 'A',
        content: '',
      });

      expect(result.success).toBe(false);
    });

    it('accepts valid question content with uppercase answer', () => {
      const result = questionContentSchema.safeParse({
        questionNumber: 1,
        answer: 'A',
        content: 'Matematica - Funcoes',
      });

      expect(result.success).toBe(true);
    });

    it('accepts valid question content with lowercase answer', () => {
      const result = questionContentSchema.safeParse({
        questionNumber: 1,
        answer: 'e',
        content: 'Portugues - Interpretacao',
      });

      expect(result.success).toBe(true);
    });

    it('accepts all valid answers A-E', () => {
      const validAnswers = ['A', 'B', 'C', 'D', 'E', 'a', 'b', 'c', 'd', 'e'];

      for (const answer of validAnswers) {
        const result = questionContentSchema.safeParse({
          questionNumber: 1,
          answer,
          content: 'Test content',
        });

        expect(result.success).toBe(true);
      }
    });

    it('rejects non-integer question number', () => {
      const result = questionContentSchema.safeParse({
        questionNumber: 1.5,
        answer: 'A',
        content: 'Matematica',
      });

      expect(result.success).toBe(false);
    });
  });
});
