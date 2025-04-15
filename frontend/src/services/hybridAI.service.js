/**
 * DESABILITADO - Redirecionador para aiServices.js
 * 
 * Este serviço foi desabilitado em favor do WhisperTranscriptionService.
 * Todas as chamadas são redirecionadas para o aiServices.js.
 */

import hybridAIStub from './aiServices';

// Exportamos diretamente o stub para substituir o hybridAI
export default hybridAIStub; 