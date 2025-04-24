import { format, parseISO, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * IMPORTANTE: Utilize sempre a função createTimezoneSafeDate para criar datas
 * com data e hora específicas no sistema. Isso garante tratamento adequado de 
 * fusos horários e evita inconsistências entre diferentes partes do sistema.
 * 
 * Evite usar diretamente o construtor new Date(year, month, day, hour, minute)
 * para datas específicas, pois isso pode causar problemas com o fuso horário.
 * 
 * ATENÇÃO para ambientes remotos: Ao enviar datas para servidores, considere usar
 * o parâmetro forceLocalDate=true para garantir que o dia selecionado seja preservado,
 * mesmo com diferenças de fuso horário entre frontend e backend.
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
 * @param {boolean} forceLocalDate - Se verdadeiro, força a preservação do dia local mesmo em UTC (útil para agendamentos)
 * @returns {Date} Objeto Date ajustado para o fuso horário apropriado
 */
export const createTimezoneSafeDate = (dateStr, timeStr, useUTC = false, forceLocalDate = false) => {
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
    
    // Se forceLocalDate é verdadeiro, verifica se o dia corresponde ao esperado
    if (forceLocalDate) {
      const localDate = new Date(date);
      const utcDay = date.getUTCDate();
      
      // Se a conversão de fuso horário alterou o dia, ajusta para manter o dia original
      if (utcDay !== day) {
        console.log(`⚠️ Diferença de dia detectada: UTC=${utcDay}, Local=${day}`);
        console.log(`⚠️ Aplicando correção para preservar o dia escolhido pelo usuário`);
        
        // Abordagem 1: Corrigir o dia na data UTC
        const correctedDate = new Date(Date.UTC(year, month - 1, day, hours, minutes));
        
        // Se ainda houver problema, tentar ajuste mais direto
        if (correctedDate.getUTCDate() !== day) {
          console.log(`⚠️ Correção básica não funcionou, aplicando método direto`);
          
          // Abordagem 2: Criar string ISO com dia forçado
          const isoString = date.toISOString();
          const [datePart, timePart] = isoString.split('T');
          const [yearPart, monthPart, _] = datePart.split('-');
          const correctedISO = `${yearPart}-${monthPart}-${day.toString().padStart(2, '0')}T${timePart}`;
          
          console.log(`🛠️ ISO corrigido: ${correctedISO}`);
          return new Date(correctedISO);
        }
        
        return correctedDate;
      }
    }
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
 * @param {boolean} forceLocalDate - Se verdadeiro, garante que o dia local seja preservado
 * @returns {string} Data em formato ISO completo
 */
export const toISOWithTimezone = (date, forceLocalDate = false) => {
  if (!date) return '';
  
  let dateObj;
  let originalDay = null;
  
  if (typeof date === 'string') {
    if (date.includes('T')) {
      // Já está em formato ISO
      dateObj = new Date(date);
    } else if (date.includes('/')) {
      // Formato DD/MM/YYYY
      const [day, month, year] = date.split('/').map(Number);
      dateObj = new Date(year, month - 1, day);
      originalDay = day;
    } else {
      // Formato YYYY-MM-DD
      dateObj = parseISO(date);
      const parts = date.split('-');
      if (parts.length === 3) {
        originalDay = parseInt(parts[2], 10);
      }
    }
  } else if (date instanceof Date) {
    dateObj = date;
    originalDay = date.getDate();
  } else {
    return '';
  }
  
  // Se forceLocalDate for verdadeiro, garantimos que o dia seja preservado
  if (forceLocalDate) {
    // Se não temos o dia original definido, obtemos da data
    if (originalDay === null) {
      originalDay = dateObj.getDate();
    }
    
    const isoString = dateObj.toISOString();
    const utcDay = new Date(isoString).getUTCDate();
    
    // Se o dia UTC é diferente do dia local, ajustamos
    if (utcDay !== originalDay) {
      console.log(`⚠️ toISOWithTimezone: Dia alterado por timezone de ${originalDay} para ${utcDay}`);
      
      // Criar uma string ISO com a parte da data modificada para usar o dia local
      const [datePart, timePart] = isoString.split('T');
      const [year, month, _] = datePart.split('-');
      const newDatePart = `${year}-${month}-${originalDay.toString().padStart(2, '0')}`;
      const correctedISO = `${newDatePart}T${timePart}`;
      
      console.log(`🛠️ ISO corrigido: ${correctedISO}`);
      return correctedISO;
    }
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