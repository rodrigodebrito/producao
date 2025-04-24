import { format, parseISO, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * IMPORTANTE: Utilize sempre a função createTimezoneSafeDate para criar datas
 * com data e hora específicas no sistema. Isso garante tratamento adequado de 
 * fusos horários e evita inconsistências entre diferentes partes do sistema.
 * 
 * Evite usar diretamente o construtor new Date(year, month, day, hour, minute)
 * para datas específicas, pois isso pode causar problemas com o fuso horário.
 */

/**
 * Converte uma string de data para o formato ISO (YYYY-MM-DD)
 * @param {string|Date} date - Data no formato DD/MM/YYYY, YYYY-MM-DD ou objeto Date
 * @returns {string} Data no formato ISO YYYY-MM-DD
 */
export const formatDateToIso = (date) => {
  if (!date) return '';
  
  // Se a data já estiver em formato ISO (yyyy-MM-dd), retorna como está
  if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) return date;
  
  // Se estiver no formato brasileiro (dd/MM/yyyy), converte para ISO
  if (typeof date === 'string' && date.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    const [day, month, year] = date.split('/').map(Number);
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  }
  
  // Se for um objeto Date, formata para ISO
  if (date instanceof Date) {
    return format(date, 'yyyy-MM-dd');
  }
  
  return '';
};

/**
 * Cria uma data considerando o fuso horário do usuário (timezone-aware)
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 * @param {string} timeStr - Hora no formato HH:MM
 * @param {boolean} useUTC - Se verdadeiro, retorna a data em UTC
 * @returns {Date} Objeto Date ajustado para o fuso horário apropriado
 */
export const createTimezoneSafeDate = (dateStr, timeStr, useUTC = false) => {
  // Validação de entrada
  if (!dateStr || !timeStr) {
    console.warn('createTimezoneSafeDate: data ou hora não fornecidas', { dateStr, timeStr });
    return new Date();
  }

  // Normaliza o formato da data
  const normalizedDate = formatDateToIso(dateStr);
  
  // Extrai os componentes
  const [year, month, day] = normalizedDate.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  
  let date;
  
  if (useUTC) {
    // Criar data em UTC
    date = new Date(Date.UTC(year, month - 1, day, hours, minutes));
    console.log(`🌐 Data UTC criada: ${date.toISOString()} para entrada ${dateStr} ${timeStr}`);
  } else {
    // Criar data no fuso horário local do usuário
    date = new Date(year, month - 1, day, hours, minutes);
    console.log(`🌐 Data local criada: ${date.toISOString()} para entrada ${dateStr} ${timeStr}`);
  }
  
  return date;
};

/**
 * Verifica se uma data/hora é futura
 * @param {string} dateStr - Data no formato YYYY-MM-DD ou DD/MM/YYYY
 * @param {string} timeStr - Hora no formato HH:MM
 * @returns {boolean} True se a data/hora for no futuro
 */
export const isValidFutureDate = (dateStr, timeStr) => {
  const now = new Date();
  const appointmentDate = createTimezoneSafeDate(dateStr, timeStr);
  
  // Retorna true se a data/hora é futura
  return isAfter(appointmentDate, now);
};

/**
 * Formata uma data para exibição no formato brasileiro
 * @param {string|Date} date - Data a ser formatada
 * @returns {string} Data formatada (DD/MM/YYYY)
 */
export const formatDisplayDate = (date) => {
  if (!date) return '';
  
  try {
    // Tentar converter para objeto Date
    const dateObj = typeof date === 'string' ? parseISO(formatDateToIso(date)) : date;
    return format(dateObj, 'dd/MM/yyyy', { locale: ptBR });
  } catch (err) {
    console.error('Erro ao formatar data para exibição:', err);
    return date;
  }
};

/**
 * Converte uma data para ISO com hora e timezone
 * @param {Date|string} date - Data a ser convertida
 * @returns {string} Data em formato ISO completo
 */
export const toISOWithTimezone = (date) => {
  if (!date) return '';
  
  let dateObj;
  
  if (typeof date === 'string') {
    if (date.includes('T')) {
      // Já está em formato ISO
      dateObj = new Date(date);
    } else if (date.includes('/')) {
      // Formato DD/MM/YYYY
      const [day, month, year] = date.split('/').map(Number);
      dateObj = new Date(year, month - 1, day);
    } else {
      // Formato YYYY-MM-DD
      dateObj = parseISO(date);
    }
  } else if (date instanceof Date) {
    dateObj = date;
  } else {
    return '';
  }
  
  return dateObj.toISOString();
};

/**
 * Extrai o fuso horário local do usuário
 * @returns {string} Fuso horário no formato +/-HH:MM
 */
export const getUserTimezone = () => {
  const offset = new Date().getTimezoneOffset();
  const absoluteOffset = Math.abs(offset);
  const hours = Math.floor(absoluteOffset / 60).toString().padStart(2, '0');
  const minutes = (absoluteOffset % 60).toString().padStart(2, '0');
  const sign = offset < 0 ? '+' : '-';
  
  return `${sign}${hours}:${minutes}`;
};

/**
 * Retorna o nome do fuso horário local
 * @returns {string} Nome do fuso horário (ex: "America/Sao_Paulo")
 */
export const getTimezoneName = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    console.warn('Não foi possível determinar o nome do fuso horário:', error);
    return 'Desconhecido';
  }
}; 