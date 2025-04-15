/**
 * Serviços de IA Centralizados - Redirecionador
 * Este arquivo substitui as importações de HybridAI para usar apenas o WhisperTranscriptionService
 */
import WhisperService from './whisperTranscriptionService';

// Stub para HybridAI - Não faz nada, apenas retorna valores simulados
const HybridAIStub = {
  initService: () => { 
    console.log('HybridAI está desabilitado. Usando apenas WhisperTranscriptionService.'); 
    return true; 
  },
  
  startRecording: () => { 
    console.log('HybridAI está desabilitado. Redirecionando para Whisper...'); 
    WhisperService.startRecordingSession();
    return true; 
  },
  
  stopRecording: () => { 
    console.log('HybridAI está desabilitado. Redirecionando para Whisper...'); 
    WhisperService.stopRecording();
  },
  
  analyzeText: () => ({
    success: true,
    dominant: 'neutral',
    sentiment: 'neutral',
    emotions: { dominant: 'neutral', scores: { neutral: 0.7 } },
    analysis: { summary: 'Serviço HybridAI desabilitado. Usando apenas Whisper.' }
  }),
  
  generateSuggestions: () => ({
    success: true,
    suggestions: ['Serviço HybridAI desabilitado. Usando apenas Whisper.']
  }),
  
  generateReport: () => ({
    success: true,
    report: 'Serviço HybridAI desabilitado. Usando apenas Whisper.'
  }),
  
  // Adicionar quaisquer outros métodos necessários aqui
  extractSessionId: () => {
    // Tentar extrair da URL usando lógica simplificada
    const url = window.location.href;
    const sessionMatch = url.match(/\/session\/([a-zA-Z0-9_-]+)/);
    if (sessionMatch && sessionMatch[1]) return sessionMatch[1];
    
    // Tentar extrair do localStorage
    return localStorage.getItem('currentSessionId') || 'session-unknown';
  }
};

// Exportação principal - substitui o HybridAI
export default HybridAIStub;

// Exportar também o WhisperService para uso direto
export { WhisperService }; 