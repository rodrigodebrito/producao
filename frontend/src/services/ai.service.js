import api from './api';

/**
 * Serviço para interação com as funcionalidades de IA
 */
const aiService = {
  /**
   * Adiciona uma nova transcrição à sessão
   * @param {Object} data - Dados da transcrição
   * @returns {Promise} Resposta da API
   */
  async addTranscription(data) {
    try {
      const response = await api.post('/api/ai/transcriptions', data);
      return response.data;
    } catch (error) {
      console.error('Erro ao adicionar transcrição:', error);
      throw error;
    }
  },

  /**
   * Obtém as transcrições de uma sessão
   * @param {string} sessionId - ID da sessão
   * @returns {Promise} Lista de transcrições
   */
  async getSessionTranscripts(sessionId) {
    try {
      const response = await api.get(`/api/ai/transcriptions/session/${sessionId}`);
      return response.data;
    } catch (error) {
      console.error('Erro ao obter transcrições:', error);
      throw error;
    }
  },

  /**
   * Analisa uma sessão
   * @param {string} sessionId - ID da sessão
   * @param {Object} emotions - Objeto com emoções detectadas (opcional)
   * @returns {Promise} Análise da sessão
   */
  async analyzeSession(sessionId, emotions = null) {
    try {
      // Incluir emoções na solicitação se fornecidas
      const payload = emotions ? { sessionId, emotions } : { sessionId };
      const response = await api.post(`/api/ai/analyze/session`, payload);
      return response.data;
    } catch (error) {
      console.error('Erro ao analisar sessão:', error);
      throw error;
    }
  },

  /**
   * Gera sugestões em tempo real
   * @param {string} sessionId - ID da sessão
   * @param {Object} emotions - Objeto com emoções detectadas (opcional)
   * @returns {Promise} Sugestões para o terapeuta
   */
  async generateSuggestions(sessionId, emotions = null) {
    try {
      // Incluir emoções na solicitação se fornecidas
      const payload = emotions ? { sessionId, emotions } : { sessionId };
      const response = await api.post(`/api/ai/suggestions/session`, payload);
      return response.data;
    } catch (error) {
      console.error('Erro ao gerar sugestões:', error);
      throw error;
    }
  },

  /**
   * Gera relatório da sessão
   * @param {string} sessionId - ID da sessão
   * @param {Object} emotions - Objeto com emoções detectadas (opcional)
   * @returns {Promise} Relatório da sessão
   */
  async generateReport(sessionId, emotions = null) {
    try {
      // Incluir emoções na solicitação se fornecidas
      const payload = emotions ? { sessionId, emotions } : { sessionId };
      const response = await api.post(`/api/ai/report/session`, payload);
      return response.data;
    } catch (error) {
      console.error('Erro ao gerar relatório:', error);
      throw error;
    }
  }
};

export default aiService; 