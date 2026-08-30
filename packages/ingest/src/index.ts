// Leitor generico de planilha (copiado do ALVOR — xlsx/csv → matriz)
export { xlsxMatrixFromWorkbook, type PreParsedXlsxWorkbook, type XlsxUtils } from './sheet-parser.js';

// Modelo, detector e KPIs da DRE (novos)
export * from './dre-model.js';
export * from './account-detector.js';
export * from './dre-profile.js';
export * from './dre-kpis.js';
export * from './dre-reader.js';
