import api from './api';

// Configuração para rotas da API com prefixo
const API_BASE = '/api'; // Remover este prefixo se o backend já o adiciona
const API_VERSION = '';  // Para versões futuras

/**
 * Serviço para interações com a IA
 */
const aiService = {
  // Lista de rotas disponíveis para facilitar manutenção futura
  routes: {
    suggest: '/ai/suggest',
    transcript: '/ai/transcript',
    transcriptSummary: '/ai/transcript-summary',
    openaiCheck: '/ai/openai-check',
    analyzeSession: '/ai/analyze-session',
    analyzeSessionAdvanced: '/ai/analyze-session/advanced',
    report: '/ai/report'
  },

  /**
   * Enviar transcrição da sessão para o servidor
   * @param {string} sessionId - ID da sessão
   * @param {string} transcript - Texto da transcrição
   * @param {Object} emotions - Objeto com as emoções detectadas
   * @returns {Promise} Resposta da API
   */
  saveTranscript: async (sessionId, transcript, emotions = null) => {
    // Validação básica de entrada
    if (!sessionId) {
      console.error('aiService: sessionId é obrigatório para salvar transcrição');
      throw new Error('ID da sessão é obrigatório');
    }
    
    if (!transcript) {
      console.error('aiService: transcript é obrigatório para salvar transcrição');
      throw new Error('Texto da transcrição é obrigatório');
    }
    
    console.log(`aiService: Enviando transcrição para a sessão ${sessionId}`);
    console.log(`aiService: Tamanho do texto: ${transcript.length} caracteres`);
    
    // Preparar payload
    const payload = {
      sessionId,
      transcript,
      emotions: emotions || null
    };
    
    // Tentar até 3 vezes em caso de erro
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`aiService: Tentativa ${attempt} de salvar transcrição`);
        const response = await api.post(aiService.routes.transcript, payload);
        console.log('aiService: Transcrição salva com sucesso');
        return response.data;
      } catch (error) {
        console.error(`aiService: Erro na tentativa ${attempt}:`, error);
        lastError = error;
        
        // Esperar um pouco antes da próxima tentativa
        if (attempt < 3) {
          const delay = attempt * 500; // 500ms, 1000ms
          console.log(`aiService: Aguardando ${delay}ms antes da próxima tentativa`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // Se chegou aqui, todas as tentativas falharam
    console.error('aiService: Todas as tentativas de salvar transcrição falharam');
    throw lastError;
  },

  /**
   * Solicitar análise da sessão
   * @param {string} sessionId - ID da sessão
   * @param {string} transcript - Transcrição opcional (pode ser obtida do servidor)
   * @param {boolean} useAdvancedAnalysis - Se deve usar análise avançada
   * @returns {Promise} Resposta da API com análise
   */
  analyzeSession: async (sessionId, transcript = null, useAdvancedAnalysis = false) => {
    try {
      console.log('AI Service: Solicitando análise para sessão', sessionId);
      console.log('AI Service: Transcript:', transcript ? transcript.substring(0, 100) + '...' : 'Não fornecido');
      console.log('AI Service: Usar análise avançada:', useAdvancedAnalysis);
      
      const payload = {
        sessionId,
        transcript,
        useAdvancedAnalysis
      };
      
      console.log('AI Service: Enviando payload para análise:', payload);
      
      // Criar lista de endpoins a tentar com base no tipo de análise
      const baseEndpoints = [
        useAdvancedAnalysis ? aiService.routes.analyzeSessionAdvanced : aiService.routes.analyzeSession,
        useAdvancedAnalysis ? '/analyze-session/advanced' : '/analyze-session',
        useAdvancedAnalysis ? '/ai/analyze-session/advanced' : '/ai/analyze-session',
        useAdvancedAnalysis ? '/api/analyze-session/advanced' : '/api/analyze-session',
        useAdvancedAnalysis ? '/api/ai/analyze-session/advanced' : '/api/ai/analyze-session',
      ];
      
      // Adicionar mais endpoints específicos se estiver no modo avançado
      if (useAdvancedAnalysis) {
        baseEndpoints.push('/advanced-analysis');
        baseEndpoints.push('/ai/advanced-analysis');
        baseEndpoints.push('/api/ai/advanced-analysis');
      }
      
      let response = null;
      let lastError = null;
      
      // Tentar cada rota até que uma funcione
      for (const route of baseEndpoints) {
        try {
          console.log(`AI Service: Tentando rota ${route} para análise...`);
          response = await api.post(route, payload);
          console.log(`AI Service: Sucesso com a rota ${route}`);
          
          // Se chegou aqui, a rota funcionou
          // Atualizar a rota no objeto para futuras chamadas
          if (useAdvancedAnalysis) {
            aiService.routes.analyzeSessionAdvanced = route;
          } else {
            aiService.routes.analyzeSession = route;
          }
          break;
        } catch (error) {
          console.warn(`AI Service: Falha na rota ${route}:`, error.message);
          lastError = error;
          continue;
        }
      }
      
      // Se todas as rotas falharam, lançar o último erro
      if (!response) {
        throw lastError || new Error('Todas as rotas falharam');
      }
      
      console.log('AI Service: Resposta da análise recebida:', response.data);
      
      // Verificar se a resposta contém dados válidos
      if (!response.data || (Object.keys(response.data).length === 0)) {
        console.warn('AI Service: Resposta vazia recebida do servidor para análise');
        return {
          type: 'analysis',
          analysis: 'Não foi possível gerar análise no momento.',
          content: 'O serviço de IA está temporariamente indisponível ou não há transcrição suficiente para análise.'
        };
      }
      
      return response.data;
    } catch (error) {
      console.error('Erro ao analisar sessão:', error);
      console.error('Detalhes do erro:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      
      // Fornecer uma resposta de fallback em caso de erro
      return {
        type: 'analysis',
        error: 'Erro ao conectar com o serviço de IA',
        message: error.message,
        analysis: 'Não foi possível realizar a análise da sessão no momento.',
        content: 'Houve um problema ao processar sua solicitação de análise.'
      };
    }
  },

  /**
   * Solicitar sugestões para a sessão
   * @param {string} sessionId - ID da sessão
   * @param {string} transcript - Transcrição opcional (pode ser obtida do servidor)
   * @returns {Promise} Resposta da API com sugestões
   */
  generateSuggestions: async (sessionId, transcript = null) => {
    try {
      console.log('AI Service: Solicitando sugestões para sessão', sessionId);
      console.log('AI Service: Transcript:', transcript ? transcript.substring(0, 100) + '...' : 'Não fornecido');
      
      const payload = {
        sessionId,
        transcript
      };
      
      console.log('AI Service: Enviando payload:', payload);
      
      // Verificar se a API OpenAI está configurada
      try {
        const openaiCheck = await api.get(aiService.routes.openaiCheck);
        console.log('AI Service: Status da API OpenAI:', openaiCheck.data);
      } catch (openaiError) {
        console.warn('AI Service: Erro ao verificar API OpenAI:', openaiError);
      }
      
      // Lista de possíveis rotas a tentar
      const routesToTry = [
        aiService.routes.suggest,         // Rota primária
        '/suggest',                       // Rota sem prefixo
        '/ai/suggest',                    // Rota com prefixo simplificado
        '/api/suggest',                   // Prefixo api, sem ai
        '/api/ai/suggest',                // Prefixo completo
      ];
      
      let response = null;
      let lastError = null;
      
      // Tentar cada rota até que uma funcione
      for (const route of routesToTry) {
        try {
          console.log(`AI Service: Tentando rota ${route} para sugestões...`);
          response = await api.post(route, payload);
          console.log(`AI Service: Sucesso com a rota ${route}`);
          
          // Se chegou aqui, a rota funcionou
          // Atualizar a rota no objeto para futuras chamadas
          aiService.routes.suggest = route;
          break;
        } catch (error) {
          console.warn(`AI Service: Falha na rota ${route}:`, error.message);
          lastError = error;
          continue;
        }
      }
      
      // Se todas as rotas falharam, lançar o último erro
      if (!response) {
        throw lastError || new Error('Todas as rotas falharam');
      }
      
      console.log('AI Service: Resposta recebida:', response.data);
      
      // Verificar se a resposta contém dados válidos
      if (!response.data || (Object.keys(response.data).length === 0)) {
        console.warn('AI Service: Resposta vazia recebida do servidor');
        return {
          type: 'suggestions',
          suggestions: ['Não foi possível gerar sugestões no momento.'],
          content: 'O serviço de IA está temporariamente indisponível ou não há transcrição suficiente para análise.'
        };
      }
      
      // Verificar formato da resposta
      const responseData = response.data;
      
      if (responseData.data && responseData.data.suggestions) {
        // Formatar resposta no formato esperado pelo frontend
        console.log('AI Service: Formatando resposta com sugestões do OpenAI');
        return {
          type: 'suggestions',
          suggestions: typeof responseData.data.suggestions === 'string' 
            ? responseData.data.suggestions.split('\n').filter(line => line.trim())
            : [responseData.data.suggestions],
          content: 'Sugestões baseadas na análise da sessão atual'
        };
      }
      
      // Se não houver sugestões, adicionar uma mensagem padrão
      if (!responseData.suggestions && !responseData.error) {
        responseData.suggestions = ['Não foram encontradas sugestões específicas para esta conversa.'];
        responseData.content = 'Continue a sessão para obter insights mais específicos.';
      }
      
      return responseData;
    } catch (error) {
      console.error('Erro ao gerar sugestões:', error);
      console.error('Detalhes do erro:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      
      // Fornecer uma resposta de fallback em caso de erro
      return {
        type: 'suggestions',
        error: 'Erro ao conectar com o serviço de IA',
        message: error.message,
        suggestions: ['Tente novamente mais tarde.'],
        content: 'Houve um problema ao processar sua solicitação.'
      };
    }
  },

  /**
   * Solicitar relatório da sessão
   * @param {string} sessionId - ID da sessão
   * @param {string} transcript - Transcrição opcional (pode ser obtida do servidor)
   * @returns {Promise} Resposta da API com relatório
   */
  generateReport: async (sessionId, transcript = null) => {
    try {
      console.log(`aiService: Gerando relatório para sessão ${sessionId}`);
      
      // Preparar dados para enviar à API
      const payload = transcript 
        ? { sessionId, transcript } 
        : { sessionId };
      console.log(`aiService: Enviando payload para API:`, payload);
      
      // Lista de possíveis rotas a tentar
      const routesToTry = [
        aiService.routes.report,         // Rota primária
        '/report',                       // Rota sem prefixo
        '/ai/report',                    // Rota com prefixo simplificado
        '/api/report',                   // Prefixo api, sem ai
        '/api/ai/report',                // Prefixo completo
      ];
      
      let response = null;
      let lastError = null;
      
      // Tentar cada rota até que uma funcione
      for (const route of routesToTry) {
        try {
          console.log(`aiService: Tentando rota ${route} para relatório...`);
          response = await api.post(route, payload);
          console.log(`aiService: Sucesso com a rota ${route}`);
          
          // Se chegou aqui, a rota funcionou
          // Atualizar a rota no objeto para futuras chamadas
          aiService.routes.report = route;
          break;
        } catch (error) {
          console.warn(`aiService: Falha na rota ${route}:`, error.message);
          lastError = error;
          continue;
        }
      }
      
      // Se todas as rotas falharam, lançar o último erro
      if (!response) {
        throw lastError || new Error('Todas as rotas falharam');
      }
      
      // Verificar e logar a resposta
      console.log(`aiService: Resposta da API:`, response);
      
      // Verificar se a resposta contém dados válidos
      if (!response.data || (Object.keys(response.data).length === 0)) {
        console.error('aiService: Resposta vazia ou inválida da API');
        return { error: 'Resposta vazia ou inválida da API' };
      }
      
      // Retornar dados
      console.log(`aiService: Retornando dados do relatório:`, response.data);
      return response.data;
    } catch (error) {
      console.error('aiService: Erro ao gerar relatório:', error);
      return { 
        error: error.message, 
        status: error.response?.status,
        details: error.response?.data
      };
    }
  },

  transcribeAudio: async (formData) => {
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        console.log('Sending audio for transcription...');
        const response = await api.post('/ai/transcribe-audio', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        
        console.log('Transcription response:', response.data);
        return response.data;
      } catch (error) {
        attempts++;
        console.error(`Transcription attempt ${attempts} failed:`, error);
        
        if (attempts >= maxAttempts) {
          throw new Error('Failed to transcribe audio after multiple attempts');
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
};

export default aiService; 