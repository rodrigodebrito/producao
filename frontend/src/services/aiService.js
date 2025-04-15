/**
 * Serviço de IA - Versão Simplificada
 * 
 * Este arquivo substitui o serviço de IA original para evitar chamadas ao backend.
 * Todas as funções retornam dados simulados para manter a compatibilidade.
 */

// Funções simuladas para evitar chamadas ao backend
const aiService = {
  // Analisar sessão
  analyzeSession: (sessionId, emotions = null) => {
    console.log(`aiService: Análise simulada para sessão ${sessionId}`);
    return {
      success: true,
      analysis: 'Análise simulada - Usando apenas WhisperTranscriptionService',
      timestamp: new Date().toISOString(),
      dominant: 'neutral',
      sentiment: 'neutral',
    };
  },
  
  // Gerar sugestões
  generateSuggestions: (sessionId, emotions = null) => {
    console.log(`aiService: Sugestões simuladas para sessão ${sessionId}`);
    return {
      success: true,
      suggestions: [
        'O serviço de IA está desabilitado. Usando apenas WhisperTranscriptionService.',
        'Para análises mais avançadas, verifique a configuração do backend.'
      ],
      timestamp: new Date().toISOString()
    };
  },
  
  // Gerar relatório
  generateReport: (sessionId, emotions = null) => {
    console.log(`aiService: Relatório simulado para sessão ${sessionId}`);
    return {
      success: true,
      report: 'O serviço de IA está desabilitado. Usando apenas WhisperTranscriptionService.',
      timestamp: new Date().toISOString()
    };
  },
  
  // Outras funções que possam ser necessárias
  transcribeAudio: () => ({ success: true, text: 'Transcrição simulada' }),
  analyzeText: () => ({ success: true, analysis: 'Análise simulada' }),
  detectEmotion: () => ({ success: true, emotion: 'neutral' })
};

export default aiService; 