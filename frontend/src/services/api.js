import axios from 'axios';
// Remove the circular import
// import { getToken } from './authService';
import { API_URL } from '../config';

// Log para depuração
console.log('Configurando API com URL base:', API_URL);

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include auth token
api.interceptors.request.use(
  (config) => {
    // Get token directly from localStorage instead of authService
    const token = localStorage.getItem('token');
    
    // Log detalhado para cada requisição
    console.log(`🚀 REQUISIÇÃO ENVIADA: ${config.method.toUpperCase()} ${config.baseURL}${config.url}`);
    console.log('📝 Dados:', config.data ? JSON.parse(JSON.stringify(config.data)) : 'Sem dados');
    console.log('🔑 Token presente:', token ? 'Sim' : 'Não');
    console.log('📋 Headers:', config.headers);
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log('✅ Token adicionado ao cabeçalho de autorização');
    } else {
      console.warn('❌ Sem token disponível para esta requisição');
    }
    
    return config;
  },
  (error) => {
    console.error('❌ Erro no interceptor de requisição:', error);
    return Promise.reject(error);
  }
);

// Adicionar interceptor de resposta para log de erros
api.interceptors.response.use(
  (response) => {
    // Log de sucesso
    console.log(`✅ RESPOSTA RECEBIDA: ${response.status} ${response.config.method.toUpperCase()} ${response.config.url}`);
    console.log('📊 Dados recebidos:', response.data);
    return response;
  },
  (error) => {
    // Logar detalhes do erro para depuração
    if (error.response) {
      // A requisição foi feita e o servidor respondeu com um status diferente de 2xx
      console.error(`❌ ERRO DE RESPOSTA: ${error.response.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
      console.error('📋 Dados do erro:', error.response.data);
      console.error('📋 Headers da resposta:', error.response.headers);
    } else if (error.request) {
      // A requisição foi feita mas não recebeu resposta
      console.error('❌ ERRO SEM RESPOSTA - A requisição foi enviada, mas o servidor não respondeu:');
      console.error('📋 Requisição:', error.request);
      console.error('📋 URL:', error.config?.url);
      console.error('📋 Método:', error.config?.method);
      console.error('📋 Dados enviados:', error.config?.data);
    } else {
      // Algo aconteceu na configuração da requisição que causou o erro
      console.error('❌ ERRO DE CONFIGURAÇÃO:', error.message);
    }
    
    return Promise.reject(error);
  }
);

export default api; 