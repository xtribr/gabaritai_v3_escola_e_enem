/**
 * TRI Data Loader - Carrega dados históricos do ENEM para cálculos TRI
 * Stub file - dados estáticos para deploy
 */

export interface TRIDataEntry {
  year: number;
  area: string;
  difficulty: number;
  discrimination: number;
  guessing: number;
}

/**
 * Dados históricos TRI do ENEM (simplificado)
 * Em produção, isso seria carregado de um banco de dados
 */
const TRI_DATA: TRIDataEntry[] = [];

export class TRIDataLoader {
  private data: TRIDataEntry[] = [];

  constructor() {
    this.data = TRI_DATA;
  }

  /**
   * Carrega dados TRI para uma área específica
   */
  getDataByArea(area: string): TRIDataEntry[] {
    return this.data.filter(d => d.area === area);
  }

  /**
   * Carrega todos os dados TRI
   */
  getAllData(): TRIDataEntry[] {
    return this.data;
  }

  /**
   * Verifica se há dados carregados
   */
  hasData(): boolean {
    return this.data.length > 0;
  }
}
