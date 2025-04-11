/**
 * Serviço para interação com a API do Daily.co
 * 
 * Este serviço gerencia a criação, configuração e encerramento
 * de videoconferências utilizando a plataforma Daily.co
 */

const axios = require('axios');
require('dotenv').config();

// Constantes
const DAILY_API_KEY = process.env.DAILY_API_KEY || 'seu_api_key_aqui';
const DAILY_API_URL = 'https://api.daily.co/v1';

// Usando o domínio correto confirmado pelo usuário
const DAILY_DOMAIN = 'teraconect.daily.co';

class DailyService {
  constructor() {
    // Validar se a API key está configurada
    if (!DAILY_API_KEY || DAILY_API_KEY === 'seu_api_key_aqui') {
      console.warn('AVISO: API key do Daily.co não configurada. Algumas funcionalidades podem não funcionar corretamente.');
    }
    
    // Configurar cliente HTTP para API do Daily
    this.client = axios.create({
      baseURL: DAILY_API_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DAILY_API_KEY}`
      },
      timeout: 10000 // 10 segundos
    });
    
    console.log('Serviço Daily.co inicializado com domínio:', DAILY_DOMAIN);
  }
  
  /**
   * Valida se uma sala existe e a retorna, ou cria uma nova sala
   * @param {string} roomName - Nome da sala a verificar/criar
   * @returns {Promise<Object>} - Detalhes da sala
   */
  async validateAndGetRoom(roomName) {
    try {
      console.log(`Solicitação para validar sala com nome original: ${roomName}`);
      
      // Garantir que sempre teremos um nome válido para a sala
      if (!roomName) {
        roomName = `room-${Date.now().toString().slice(-6)}`;
        console.log(`Nome não fornecido, gerando nome automático: ${roomName}`);
      }
      
      // Remover prefixo 'tc-' se existir
      if (roomName.startsWith('tc-')) {
        roomName = roomName.substring(3);
        console.log('Prefixo tc- removido, usando nome limpo:', roomName);
      }
      
      // IMPORTANTE: Sempre simplificar o nome da sala para evitar problemas de compatibilidade
      // Pegar apenas os primeiros 8 caracteres do ID original para garantir compatibilidade
      let simpleRoomName;
      if (roomName.includes('-')) {
        // Se for um UUID, extrair a primeira parte
        simpleRoomName = roomName.split('-')[0];
        console.log(`Nome parece ser UUID, extraindo primeira parte: ${simpleRoomName}`);
      } else if (roomName.length > 10) {
        // Se for muito longo, truncar
        simpleRoomName = roomName.substring(0, 8);
        console.log(`Nome muito longo, truncando para: ${simpleRoomName}`);
      } else {
        // Manter o nome se for curto o suficiente
        simpleRoomName = roomName;
      }
      
      // Adicionar prefixo para evitar colisões
      const finalRoomName = `tc-${simpleRoomName}`;
      console.log(`Nome final para sala Daily.co: ${finalRoomName}`);
      
      // Verificar se a sala já existe com o nome simplificado
      try {
        const response = await this.client.get(`/rooms/${finalRoomName}`);
        console.log('Sala existente encontrada:', finalRoomName);
        return {
          url: `https://${DAILY_DOMAIN}/${finalRoomName}`,
          name: finalRoomName,
          originalName: roomName
        };
      } catch (error) {
        // Se a sala não existe (404) ou outro erro, criamos uma nova
        if (error.response && error.response.status === 404) {
          console.log('Sala não existe, criando nova com nome:', finalRoomName);
          const result = await this.createRoom(finalRoomName);
          // Adicionar o nome original para referência
          result.originalName = roomName;
          return result;
        } else {
          console.error('Erro ao verificar sala:', error.message);
          throw error;
        }
      }
    } catch (error) {
      console.error('Erro em validateAndGetRoom:', error);
      // Tentar um fallback como último recurso
      return this.createFallbackRoom(roomName);
    }
  }
  
  /**
   * Cria uma nova sala no Daily.co
   * @param {string} roomName - Nome da sala (opcional)
   * @param {number} expiryHours - Horas até a expiração da sala (opcional)
   * @returns {Promise<Object>} - Detalhes da sala criada
   */
  async createRoom(roomName, expiryHours = 24) {
    try {
      // Validar que temos um nome para a sala
      if (!roomName) {
        // Gerar um nome curto e simples baseado em timestamp para garantir compatibilidade
        const timestamp = Date.now().toString().slice(-6); // Últimos 6 dígitos do timestamp
        roomName = `tc-${timestamp}`;
        console.log(`Nome não fornecido, gerando nome simplificado: ${roomName}`);
      }
      
      console.log(`Solicitação para criar sala: ${roomName}`);
      
      // Configurar propriedades da sala
      const properties = {
        privacy: 'public',
        properties: {
          exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 horas
          enable_chat: true,
          enable_screenshare: true,
          start_video_off: false,
          start_audio_off: false,
          enable_knocking: false, // Desativar sala de espera
          enable_prejoin_ui: false, // Desativar interface de pré-entrada
          enable_pip_ui: true, // Habilitar Picture-in-Picture
          enable_network_ui: true, // Mostrar indicador de qualidade de rede
          enable_new_call_ui: true, // Usar a nova interface
          lang: 'pt-br' // Definir idioma para português
        }
      };
      
      // Criar sala na API do Daily
      const response = await this.client.post('/rooms', {
        name: roomName,
        ...properties
      });
      
      const createdRoom = response.data;
      console.log('Sala Daily.co criada com sucesso:', roomName, 'URL:', `https://${DAILY_DOMAIN}/${roomName}`);
      
      // Retornar os detalhes da sala criada
      return {
        url: `https://${DAILY_DOMAIN}/${roomName}`,
        name: roomName
      };
    } catch (error) {
      console.error('Erro ao criar sala Daily.co:', error.response ? error.response.data : error.message);
      throw new Error(`Falha ao criar sala: ${error.message}`);
    }
  }
  
  /**
   * Exclui uma sala do Daily.co
   * @param {string} roomName - Nome da sala a ser excluída
   * @returns {Promise<boolean>} - Sucesso da operação
   */
  async deleteRoom(roomName) {
    try {
      await this.client.delete(`/rooms/${roomName}`);
      console.log('Sala Daily.co excluída:', roomName);
      return true;
    } catch (error) {
      // Se a sala não existe, consideramos como sucesso na exclusão
      if (error.response && error.response.status === 404) {
        console.log('Sala não existe, nada a excluir:', roomName);
        return true;
      }
      
      console.error('Erro ao excluir sala Daily.co:', error.response ? error.response.data : error.message);
      throw new Error(`Falha ao excluir sala: ${error.message}`);
    }
  }
  
  /**
   * Cria um token de acesso para uma sala
   * @param {string} roomName - Nome da sala
   * @param {Object} options - Opções do token
   * @returns {Promise<Object>} - Token gerado
   */
  async createMeetingToken(roomName, options = {}) {
    try {
      const tokenOptions = {
        properties: {
          room_name: roomName,
          user_name: options.userName || 'Usuário',
          user_id: options.userId || `user-${Date.now()}`,
          is_owner: options.isOwner || false,
          start_audio_off: options.startAudioOff || false,
          start_video_off: options.startVideoOff || false,
          exp: Math.floor(Date.now() / 1000) + (2 * 60 * 60) // 2 horas de validade
        }
      };
      
      const response = await this.client.post('/meeting-tokens', tokenOptions);
      return {
        token: response.data.token,
        expires: response.data.expires_at
      };
    } catch (error) {
      console.error('Erro ao criar token Daily.co:', error.response ? error.response.data : error.message);
      throw new Error(`Falha ao criar token: ${error.message}`);
    }
  }
  
  /**
   * Verifica o status de uma sala
   * @param {string} roomName - Nome da sala
   * @returns {Promise<Object>} - Status da sala
   */
  async getRoomStatus(roomName) {
    try {
      const response = await this.client.get(`/rooms/${roomName}`);
      return {
        exists: true,
        created: response.data.created_at,
        expires: response.data.config && response.data.config.exp,
        details: response.data
      };
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return {
          exists: false,
          message: 'Sala não encontrada'
        };
      }
      
      console.error('Erro ao verificar status da sala Daily.co:', error.response ? error.response.data : error.message);
      throw new Error(`Falha ao verificar status da sala: ${error.message}`);
    }
  }
  
  /**
   * Método de fallback para criar uma sala com nome simplificado baseado em timestamp
   * @param {string} originalName - Nome original da sala (para referência)
   * @returns {Promise<Object>} - Detalhes da sala criada
   */
  async createFallbackRoom(originalName) {
    try {
      console.log('Tentando criar sala de fallback após falha...');
      
      // Gerar um nome simples baseado em timestamp que sabemos que vai funcionar
      const timestamp = Date.now().toString().slice(-6); // Últimos 6 dígitos do timestamp
      const fallbackName = `tc-${timestamp}`;
      
      console.log(`Criando sala de fallback com nome: ${fallbackName}`);
      
      // Configurar propriedades da sala
      const properties = {
        privacy: 'public',
        properties: {
          exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 horas
          enable_chat: true,
          enable_screenshare: true,
          start_video_off: false,
          start_audio_off: false,
          enable_knocking: false, // Desativar sala de espera
          enable_prejoin_ui: false, // Desativar interface de pré-entrada
          enable_pip_ui: true, // Habilitar Picture-in-Picture
          enable_network_ui: true, // Mostrar indicador de qualidade de rede
          enable_new_call_ui: true, // Usar a nova interface
          lang: 'pt-br' // Definir idioma para português
        }
      };
      
      const response = await this.client.post('/rooms', {
        name: fallbackName,
        ...properties
      });
      
      console.log('Sala de fallback criada com sucesso:', fallbackName);
      
      // Retornar os detalhes da sala criada
      return {
        url: `https://${DAILY_DOMAIN}/${fallbackName}`,
        name: fallbackName,
        originalName: originalName,
        isFallback: true
      };
    } catch (error) {
      console.error('Erro crítico ao criar sala de fallback:', error);
      
      // Como último recurso, retornar uma URL que o cliente pode tentar usar
      // mesmo sem garantia de que a sala existe
      return {
        url: `https://${DAILY_DOMAIN}/fallback-room`,
        name: 'fallback-room',
        originalName: originalName,
        isFallback: true,
        isError: true
      };
    }
  }
}

// Criar uma instância do serviço para exportação
const dailyService = new DailyService();

// Exportar o serviço
module.exports = dailyService; 