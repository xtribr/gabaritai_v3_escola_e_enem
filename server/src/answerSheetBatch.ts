/**
 * Answer Sheet Batch Generator
 * ============================
 *
 * Gera gabaritos personalizados com QR Code para identificação de alunos.
 *
 * Fluxo:
 * 1. Escola faz upload de CSV com alunos
 * 2. Sistema cria batch + students no Supabase com sheet_codes únicos
 * 3. Sistema gera PDF com QR Codes para cada aluno
 * 4. Escola baixa PDF e imprime
 *
 * Autor: GabaritAI / X-TRI
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { supabaseAdmin } from '../lib/supabase.js';

// Caminho do logo X-TRI
const LOGO_PATH = path.resolve(process.cwd(), 'assets', 'xtri-logo.png');

// ============================================================
// TIPOS
// ============================================================

export interface StudentCSVRow {
  student_name: string;
  enrollment_code?: string;
  class_name?: string;
}

export interface AnswerSheetStudent {
  id?: string;
  batch_id: string;
  enrollment_code: string | null;
  student_name: string;
  class_name: string | null;
  sheet_code: string;
  answers?: any;
  processed_at?: string;
}

export interface AnswerSheetBatch {
  id?: string;
  school_id: string;
  exam_id: string;
  name: string;
  created_at?: string;
}

// ============================================================
// GERAÇÃO DE CÓDIGO ÚNICO
// ============================================================

/**
 * Gera código único de 6 caracteres alfanuméricos.
 * Remove caracteres ambíguos (0, O, I, 1, L).
 * Formato: XTRI-XXXXXX
 */
export function generateSheetCode(): string {
  // Alfabeto sem caracteres ambíguos
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  // Gerar 6 caracteres aleatórios
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }

  return `XTRI-${code}`;
}

/**
 * Gera múltiplos códigos únicos verificando duplicatas no banco.
 */
export async function generateUniqueSheetCodes(count: number): Promise<string[]> {
  const codes: string[] = [];
  const maxAttempts = count * 3; // Margem para colisões
  let attempts = 0;

  while (codes.length < count && attempts < maxAttempts) {
    const code = generateSheetCode();

    // Verificar se já existe no banco
    const { data } = await supabaseAdmin
      .from('answer_sheet_students')
      .select('sheet_code')
      .eq('sheet_code', code)
      .single();

    if (!data && !codes.includes(code)) {
      codes.push(code);
    }

    attempts++;
  }

  if (codes.length < count) {
    throw new Error(`Não foi possível gerar ${count} códigos únicos após ${maxAttempts} tentativas`);
  }

  return codes;
}

// ============================================================
// PROCESSAMENTO DE CSV
// ============================================================

/**
 * Normaliza nome de coluna para o formato esperado.
 */
function normalizeColumnName(name: string): string {
  const normalized = name.toLowerCase().trim();

  const mapping: Record<string, string> = {
    'matricula': 'enrollment_code',
    'matrícula': 'enrollment_code',
    'codigo': 'enrollment_code',
    'código': 'enrollment_code',
    'nome': 'student_name',
    'aluno': 'student_name',
    'estudante': 'student_name',
    'nome completo': 'student_name',
    'turma': 'class_name',
    'classe': 'class_name',
    'sala': 'class_name',
  };

  return mapping[normalized] || normalized;
}

/**
 * Processa CSV e extrai dados dos alunos.
 */
export function parseStudentCSV(csvContent: string): StudentCSVRow[] {
  // Parse CSV
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  // Normalizar colunas e extrair dados
  const students: StudentCSVRow[] = records.map((row: Record<string, string>) => {
    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = normalizeColumnName(key);
      normalized[normalizedKey] = value;
    }

    // Validar nome obrigatório
    if (!normalized.student_name) {
      throw new Error(`Linha sem nome do aluno: ${JSON.stringify(row)}`);
    }

    return {
      student_name: normalized.student_name,
      enrollment_code: normalized.enrollment_code || undefined,
      class_name: normalized.class_name || undefined,
    };
  });

  return students;
}

// ============================================================
// CRIAÇÃO DE BATCH NO SUPABASE
// ============================================================

/**
 * Cria um lote de gabaritos no Supabase.
 */
export async function createAnswerSheetBatch(
  schoolId: string,
  examId: string,
  batchName: string,
  students: StudentCSVRow[]
): Promise<{ batch: AnswerSheetBatch; students: AnswerSheetStudent[] }> {
  // 1. Criar o lote
  const { data: batchData, error: batchError } = await supabaseAdmin
    .from('answer_sheet_batches')
    .insert({
      school_id: schoolId,
      exam_id: examId,
      name: batchName,
    })
    .select()
    .single();

  if (batchError) {
    throw new Error(`Erro ao criar lote: ${batchError.message}`);
  }

  const batchId = batchData.id;

  // 2. Gerar códigos únicos para cada aluno
  const sheetCodes = await generateUniqueSheetCodes(students.length);

  // 3. Preparar dados dos alunos
  const studentsData: Omit<AnswerSheetStudent, 'id' | 'answers' | 'processed_at'>[] = students.map((student, index) => ({
    batch_id: batchId,
    enrollment_code: student.enrollment_code || null,
    student_name: student.student_name,
    class_name: student.class_name || null,
    sheet_code: sheetCodes[index],
  }));

  // 4. Inserir alunos
  const { data: insertedStudents, error: studentsError } = await supabaseAdmin
    .from('answer_sheet_students')
    .insert(studentsData)
    .select();

  if (studentsError) {
    // Rollback: deletar o lote
    await supabaseAdmin.from('answer_sheet_batches').delete().eq('id', batchId);
    throw new Error(`Erro ao inserir alunos: ${studentsError.message}`);
  }

  return {
    batch: batchData as AnswerSheetBatch,
    students: insertedStudents as AnswerSheetStudent[],
  };
}

// ============================================================
// GERAÇÃO DE PDF
// ============================================================

// Dimensões A4 em pontos (72 pontos por polegada)
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

// ============================================================
// CONFIGURAÇÃO DO TEMPLATE XTRI (compatível com OMR)
// ============================================================
// Coordenadas baseadas no template original em 150 DPI
// Fator de conversão: 72/150 = 0.48
const PIXEL_TO_POINTS = 72 / 150;

// Posições dos 4 marcadores de canto (em 150 DPI pixels)
const MARKERS_150DPI = {
  TL: { x: 57, y: 463 },
  TR: { x: 1184, y: 463 },
  BL: { x: 57, y: 1141 },
  BR: { x: 1184, y: 1141 },
};
const MARKER_SIZE_PX = 32;  // pixels em 150 DPI (área ~1024 para OMR)

// Coordenadas do grid de bolhas (150 DPI)
const GRID_START_X = 120;
const GRID_START_Y = 520;
const BUBBLE_SPACING_X = 25;    // Entre opções A-B-C-D-E
const COLUMN_SPACING = 179;      // Entre colunas de questões
const ROW_SPACING = 41.7;        // Entre linhas
const BUBBLE_RADIUS_PX = 9;      // Raio das bolhas em pixels

// Configurações gerais
const MARGIN = 40;
const QR_SIZE = 80;
const QUESTIONS_PER_COLUMN = 15;
const NUM_COLUMNS = 6;
const OPTIONS = ['A', 'B', 'C', 'D', 'E'];

// Funções de conversão de coordenadas
function pxToPtX(px: number): number {
  return px * PIXEL_TO_POINTS;
}

function pxToPtY(px: number): number {
  // ReportLab/PDF tem Y=0 no bottom, pixels têm Y=0 no top
  // Página @ 150 DPI = 1754 pixels de altura
  return A4_HEIGHT - (px * PIXEL_TO_POINTS);
}

/**
 * Gera QR Code como data URL (PNG base64).
 */
async function generateQRCodeDataURL(data: string): Promise<string> {
  return QRCode.toDataURL(data, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 200,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}

/**
 * Desenha os marcadores de canto (quadrados pretos para alinhamento OMR).
 * Usa posições exatas do template XTRI em 150 DPI.
 */
function drawCornerMarkers(page: any) {
  const markerSizePt = pxToPtX(MARKER_SIZE_PX);

  for (const [name, pos] of Object.entries(MARKERS_150DPI)) {
    const px = pxToPtX(pos.x);
    const py = pxToPtY(pos.y);

    page.drawRectangle({
      x: px - markerSizePt / 2,
      y: py - markerSizePt / 2,
      width: markerSizePt,
      height: markerSizePt,
      color: rgb(0, 0, 0),
    });
  }
}

/**
 * Desenha a grade de bolhas (90 questões) com letras dentro.
 * Usa posições exatas do template XTRI em 150 DPI.
 */
function drawBubbleGrid(page: any, font: any, boldFont: any) {
  const bubbleRadiusPt = pxToPtX(BUBBLE_RADIUS_PX);

  // Desenhar separadores verticais entre colunas
  const firstY = pxToPtY(GRID_START_Y - 15);
  const lastY = pxToPtY(GRID_START_Y + (QUESTIONS_PER_COLUMN - 1) * ROW_SPACING + 15);

  for (let colIdx = 1; colIdx < NUM_COLUMNS; colIdx++) {
    const sepX = GRID_START_X + (colIdx * COLUMN_SPACING) - (COLUMN_SPACING - 4 * BUBBLE_SPACING_X) / 2 - 15;
    const sepXPt = pxToPtX(sepX);
    page.drawLine({
      start: { x: sepXPt, y: firstY },
      end: { x: sepXPt, y: lastY },
      thickness: 0.3,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  // Desenhar bolhas com letras dentro
  for (let colIdx = 0; colIdx < NUM_COLUMNS; colIdx++) {
    for (let rowIdx = 0; rowIdx < QUESTIONS_PER_COLUMN; rowIdx++) {
      const qNum = colIdx * QUESTIONS_PER_COLUMN + rowIdx + 1;
      const y = GRID_START_Y + (rowIdx * ROW_SPACING);

      // Número da questão
      const numX = GRID_START_X + (colIdx * COLUMN_SPACING) - 30;
      const numText = qNum.toString().padStart(2, '0');
      page.drawText(numText, {
        x: pxToPtX(numX),
        y: pxToPtY(y) - 3,
        size: 7,
        font: font,
        color: rgb(0, 0, 0),
      });

      // Desenhar as 5 bolhas com letras dentro
      for (let optIdx = 0; optIdx < OPTIONS.length; optIdx++) {
        const x = GRID_START_X + (colIdx * COLUMN_SPACING) + (optIdx * BUBBLE_SPACING_X);
        const cx = pxToPtX(x);
        const cy = pxToPtY(y);

        // Bolha vazia - círculo branco com contorno preto e letra preta dentro
        page.drawEllipse({
          x: cx,
          y: cy,
          xScale: bubbleRadiusPt,
          yScale: bubbleRadiusPt,
          color: rgb(1, 1, 1),
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.5,
        });

        // Letra preta dentro da bolha
        page.drawText(OPTIONS[optIdx], {
          x: cx - 2.5,
          y: cy - 2.5,
          size: 7,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
      }
    }
  }
}

/**
 * Gera página de gabarito para um aluno.
 */
async function generateAnswerSheetPage(
  pdfDoc: PDFDocument,
  student: AnswerSheetStudent,
  examName: string,
  font: any,
  boldFont: any,
  logoImage: any | null
): Promise<void> {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

  // ========== CABEÇALHO ==========

  // Logo X-TRI (canto superior esquerdo)
  const LOGO_SIZE = 45;
  if (logoImage) {
    page.drawImage(logoImage, {
      x: MARGIN,
      y: A4_HEIGHT - MARGIN - LOGO_SIZE,
      width: LOGO_SIZE,
      height: LOGO_SIZE,
    });
  }

  // Título (ao lado do logo)
  const titleX = logoImage ? MARGIN + LOGO_SIZE + 10 : MARGIN;
  page.drawText('CARTÃO-RESPOSTA', {
    x: titleX,
    y: A4_HEIGHT - MARGIN - 20,
    size: 18,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  page.drawText(examName.toUpperCase(), {
    x: titleX,
    y: A4_HEIGHT - MARGIN - 38,
    size: 10,
    font: font,
    color: rgb(0.3, 0.3, 0.3),
  });

  // QR Code (canto superior direito)
  const qrDataUrl = await generateQRCodeDataURL(student.sheet_code);
  const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
  const qrImage = await pdfDoc.embedPng(qrImageBytes);

  page.drawImage(qrImage, {
    x: A4_WIDTH - MARGIN - QR_SIZE,
    y: A4_HEIGHT - MARGIN - QR_SIZE,
    width: QR_SIZE,
    height: QR_SIZE,
  });

  // Código abaixo do QR
  page.drawText(student.sheet_code, {
    x: A4_WIDTH - MARGIN - QR_SIZE,
    y: A4_HEIGHT - MARGIN - QR_SIZE - 12,
    size: 8,
    font: font,
    color: rgb(0, 0, 0),
  });

  // ========== DADOS DO ALUNO ==========

  const dataStartY = A4_HEIGHT - MARGIN - 70;

  // Box com dados
  page.drawRectangle({
    x: MARGIN,
    y: dataStartY - 60,
    width: A4_WIDTH - 2 * MARGIN - QR_SIZE - 20,
    height: 60,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });

  // Nome
  page.drawText('Nome:', {
    x: MARGIN + 10,
    y: dataStartY - 15,
    size: 9,
    font: font,
    color: rgb(0.3, 0.3, 0.3),
  });

  page.drawText(student.student_name, {
    x: MARGIN + 10,
    y: dataStartY - 30,
    size: 11,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  // Matrícula e Turma na mesma linha
  let infoY = dataStartY - 50;

  if (student.enrollment_code) {
    page.drawText(`Matrícula: ${student.enrollment_code}`, {
      x: MARGIN + 10,
      y: infoY,
      size: 9,
      font: font,
      color: rgb(0, 0, 0),
    });
  }

  if (student.class_name) {
    page.drawText(`Turma: ${student.class_name}`, {
      x: MARGIN + 200,
      y: infoY,
      size: 9,
      font: font,
      color: rgb(0, 0, 0),
    });
  }

  // ========== INSTRUÇÕES ==========

  const instructionsY = dataStartY - 90;

  page.drawText('INSTRUÇÕES: Preencha completamente o círculo correspondente à resposta correta.', {
    x: MARGIN,
    y: instructionsY,
    size: 8,
    font: font,
    color: rgb(0.3, 0.3, 0.3),
  });

  page.drawText('Use caneta esferográfica preta. Não rasure.', {
    x: MARGIN,
    y: instructionsY - 12,
    size: 8,
    font: font,
    color: rgb(0.3, 0.3, 0.3),
  });

  // Linha separadora
  page.drawLine({
    start: { x: MARGIN, y: instructionsY - 25 },
    end: { x: A4_WIDTH - MARGIN, y: instructionsY - 25 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  // ========== GRADE DE BOLHAS ==========
  // Usa coordenadas fixas do template XTRI (150 DPI convertido para pontos)

  drawBubbleGrid(page, font, boldFont);

  // ========== MARCADORES DE CANTO ==========
  // Posições fixas do template XTRI para compatibilidade com OMR

  drawCornerMarkers(page);

  // ========== RODAPÉ ==========

  page.drawText('*Modelo baseado no CARTÃO-RESPOSTA do Enem', {
    x: MARGIN,
    y: MARGIN - 10,
    size: 7,
    font: font,
    color: rgb(0.5, 0.5, 0.5),
  });
}

/**
 * Gera PDF com gabaritos de todos os alunos de um lote.
 */
export async function generateBatchPDF(
  students: AnswerSheetStudent[],
  examName: string
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  // Carregar fontes
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Carregar logo X-TRI (se existir)
  let logoImage = null;
  try {
    if (fs.existsSync(LOGO_PATH)) {
      const logoBytes = fs.readFileSync(LOGO_PATH);
      logoImage = await pdfDoc.embedPng(logoBytes);
      console.log('[AnswerSheetBatch] Logo X-TRI carregado com sucesso');
    } else {
      console.warn('[AnswerSheetBatch] Logo não encontrado:', LOGO_PATH);
    }
  } catch (error) {
    console.error('[AnswerSheetBatch] Erro ao carregar logo:', error);
  }

  // Gerar página para cada aluno
  for (const student of students) {
    await generateAnswerSheetPage(pdfDoc, student, examName, font, boldFont, logoImage);
  }

  // Salvar PDF
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

/**
 * Busca um lote por ID.
 */
export async function getBatchById(batchId: string): Promise<AnswerSheetBatch | null> {
  const { data, error } = await supabaseAdmin
    .from('answer_sheet_batches')
    .select('*')
    .eq('id', batchId)
    .single();

  if (error) return null;
  return data as AnswerSheetBatch;
}

/**
 * Busca alunos de um lote.
 */
export async function getStudentsByBatchId(batchId: string): Promise<AnswerSheetStudent[]> {
  const { data, error } = await supabaseAdmin
    .from('answer_sheet_students')
    .select('*')
    .eq('batch_id', batchId)
    .order('student_name');

  if (error) throw new Error(`Erro ao buscar alunos: ${error.message}`);
  return data as AnswerSheetStudent[];
}

/**
 * Busca aluno por sheet_code.
 */
export async function getStudentBySheetCode(sheetCode: string): Promise<AnswerSheetStudent | null> {
  const { data, error } = await supabaseAdmin
    .from('answer_sheet_students')
    .select('*, answer_sheet_batches(exam_id, school_id, name)')
    .eq('sheet_code', sheetCode)
    .single();

  if (error) return null;
  return data as AnswerSheetStudent;
}

/**
 * Atualiza respostas de um aluno.
 */
export async function updateStudentAnswers(
  sheetCode: string,
  answers: any[]
): Promise<AnswerSheetStudent | null> {
  const { data, error } = await supabaseAdmin
    .from('answer_sheet_students')
    .update({
      answers: answers,
      processed_at: new Date().toISOString(),
    })
    .eq('sheet_code', sheetCode)
    .select()
    .single();

  if (error) throw new Error(`Erro ao atualizar respostas: ${error.message}`);
  return data as AnswerSheetStudent;
}
