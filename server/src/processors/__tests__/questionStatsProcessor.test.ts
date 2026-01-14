import { describe, it, expect } from 'vitest';
import { QuestionStatsProcessor } from '../questionStatsProcessor';

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

describe('QuestionStatsProcessor', () => {
  describe('calculateQuestionStats', () => {
    it('should calculate 100% correct rate when all students answer correctly', () => {
      const students = [
        createStudent('001', ['A', 'B', 'C']),
        createStudent('002', ['A', 'B', 'C']),
      ];
      const answerKey = ['A', 'B', 'C'];

      const stats = QuestionStatsProcessor.calculateQuestionStats(students, answerKey);

      expect(stats).toHaveLength(3);
      expect(stats[0].correctPercentage).toBe(100);
      expect(stats[1].correctPercentage).toBe(100);
      expect(stats[2].correctPercentage).toBe(100);
    });

    it('should calculate 50% when half students answer correctly', () => {
      const students = [
        createStudent('001', ['A']),
        createStudent('002', ['B']),
      ];
      const answerKey = ['A'];

      const stats = QuestionStatsProcessor.calculateQuestionStats(students, answerKey);

      expect(stats[0].correctPercentage).toBe(50);
    });

    it('should calculate 0% when no one answers correctly', () => {
      const students = [
        createStudent('001', ['B']),
        createStudent('002', ['C']),
      ];
      const answerKey = ['A'];

      const stats = QuestionStatsProcessor.calculateQuestionStats(students, answerKey);

      expect(stats[0].correctPercentage).toBe(0);
    });

    it('should be case-insensitive', () => {
      const students = [
        createStudent('001', ['a', 'b']),
        createStudent('002', ['A', 'B']),
      ];
      const answerKey = ['A', 'B'];

      const stats = QuestionStatsProcessor.calculateQuestionStats(students, answerKey);

      expect(stats[0].correctPercentage).toBe(100);
      expect(stats[1].correctPercentage).toBe(100);
    });

    it('should filter by question range', () => {
      const students = [
        createStudent('001', ['A', 'B', 'C', 'D', 'E']),
      ];
      const answerKey = ['A', 'B', 'C', 'D', 'E'];

      // Questões 2 a 4 (índices 1-3)
      const stats = QuestionStatsProcessor.calculateQuestionStats(
        students,
        answerKey,
        2,
        4
      );

      expect(stats).toHaveLength(3); // Questions 2, 3, 4
      expect(stats[0].questionNumber).toBe(2);
      expect(stats[2].questionNumber).toBe(4);
    });

    it('should include questionNumber in results', () => {
      const students = [createStudent('001', ['A', 'B', 'C'])];
      const answerKey = ['A', 'B', 'C'];

      const stats = QuestionStatsProcessor.calculateQuestionStats(students, answerKey);

      expect(stats[0].questionNumber).toBe(1);
      expect(stats[1].questionNumber).toBe(2);
      expect(stats[2].questionNumber).toBe(3);
    });

    it('should handle empty answers as not attempted (excluded from calculation)', () => {
      const students = [
        createStudent('001', ['A', '']),  // Só respondeu Q1
        createStudent('002', ['A', 'B']), // Respondeu ambas
      ];
      const answerKey = ['A', 'B'];

      const stats = QuestionStatsProcessor.calculateQuestionStats(students, answerKey);

      expect(stats[0].correctPercentage).toBe(100); // 2/2 responderam certo Q1
      expect(stats[1].correctPercentage).toBe(100); // Apenas 1 respondeu Q2, e acertou
    });

    it('should throw error for empty student list', () => {
      expect(() => QuestionStatsProcessor.calculateQuestionStats([], ['A'])).toThrow();
    });

    it('should throw error for empty answer key', () => {
      expect(() => QuestionStatsProcessor.calculateQuestionStats([createStudent('001', ['A'])], [])).toThrow();
    });
  });

  describe('calculateQuestionStatsForRange', () => {
    it('should return questionNumber relative to start (beginning at 1)', () => {
      const students = [createStudent('001', ['A', 'B', 'C', 'D', 'E'])];
      const answerKey = ['A', 'B', 'C', 'D', 'E'];

      // Range: questões 3 a 5
      const stats = QuestionStatsProcessor.calculateQuestionStatsForRange(
        students,
        answerKey,
        3,
        5
      );

      expect(stats).toHaveLength(3);
      expect(stats[0].questionNumber).toBe(1); // Q3 vira Q1
      expect(stats[1].questionNumber).toBe(2); // Q4 vira Q2
      expect(stats[2].questionNumber).toBe(3); // Q5 vira Q3
    });
  });
});
