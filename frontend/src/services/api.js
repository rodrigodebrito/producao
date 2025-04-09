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
    
    // Log para depuração
    console.log(`Interceptor de API: URL da requisição: ${config.url}`);
    console.log(`Interceptor de API: Método: ${config.method}`);
    console.log(`Interceptor de API: Token presente: ${token ? 'Sim' : 'Não'}`);
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log('Token adicionado ao cabeçalho de autorização');
    } else {
      console.warn('Sem token disponível para esta requisição');
    }
    
    return config;
  },
  (error) => {
    console.error('Erro no interceptor de requisição:', error);
    return Promise.reject(error);
  }
);

// Adicionar interceptor de resposta para log de erros
api.interceptors.response.use(
  (response) => {
    // Sucesso - apenas retorna a resposta
    return response;
  },
  (error) => {
    // Logar detalhes do erro para depuração
    console.error('Erro na resposta da API:', {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      data: error.response?.data,
      hasToken: !!error.config?.headers?.Authorization
    });
    
    return Promise.reject(error);
  }
);

export default api; 