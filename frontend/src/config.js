// Configuração global da aplicação

// Determinar o ambiente atual
const isDevelopment = 
  window.location.hostname === 'localhost' || 
  window.location.hostname === '127.0.0.1';

// URLs baseadas no ambiente
export const API_URL = isDevelopment 
  ? 'http://localhost:3000/api'
  : 'https://theraconnect-prd.onrender.com/api';

// URL base do servidor Socket.IO
export const SOCKET_URL = isDevelopment 
  ? 'http://localhost:3000'
  : 'https://theraconnect-prd.onrender.com';

// URL base do servidor Whisper API (transcrição)
export const WHISPER_URL = isDevelopment 
  ? 'http://localhost:3000/api/ai/whisper/transcribe'
  : 'https://theraconnect-prd.onrender.com/api/ai/whisper/transcribe';

export const FRONTEND_URL = isDevelopment
  ? 'http://localhost:3001'
  : 'https://terapia-conect-frontend.vercel.app';

// URL base da API para facilitar importação
export const BASE_API_URL = API_URL;

// Debug global para mostrar qual URL está sendo usada
console.log(`CONFIG.JS - URL da API configurada: ${BASE_API_URL} (${isDevelopment ? 'desenvolvimento' : 'produção'})`);
console.log(`CONFIG.JS - URL do Socket.IO configurada: ${SOCKET_URL} (${isDevelopment ? 'desenvolvimento' : 'produção'})`);
console.log(`CONFIG.JS - URL da Whisper API configurada: ${WHISPER_URL} (${isDevelopment ? 'desenvolvimento' : 'produção'})`);

// Injetar URL global na janela para debug
if (typeof window !== 'undefined') {
  window.__API_CONFIG = {
    url: BASE_API_URL,
    socketUrl: SOCKET_URL,
    whisperUrl: WHISPER_URL,
    environment: isDevelopment ? 'development' : 'production',
    timestamp: new Date().toISOString()
  };
}

// Exportar configuração para uso em toda a aplicação
export default {
  apiUrl: BASE_API_URL,
  socketUrl: SOCKET_URL,
  whisperUrl: WHISPER_URL,
  frontendUrl: FRONTEND_URL,
  isDevelopment
};