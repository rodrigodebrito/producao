/**
 * Controlador para WebRTC
 * Gerencia as requisições para o serviço WebRTC de captura de áudio
 */

const webRTCService = require('../services/media/webrtc.service');
const { createLogger } = require('../utils/logger');
const logger = createLogger('webrtc-controller');

/**
 * Controlador para WebRTC
 */
const webRTCController = {
  /**
   * Inicia uma sessão WebRTC
   * @param {Object} req - Requisição Express
   * @param {Object} res - Resposta Express
   */
  async initSession(req, res) {
    try {
      const { sessionId } = req.params;
      
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'ID da sessão não fornecido'
        });
      }
      
      logger.info(`Iniciando sessão WebRTC para sessão ${sessionId}`);
      
      const session = await webRTCService.getSession(sessionId);
      
      if (!session) {
        return res.status(500).json({
          success: false,
          message: 'Falha ao iniciar sessão WebRTC'
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'Sessão WebRTC iniciada com sucesso',
        sessionId
      });
    } catch (error) {
      logger.error(`Erro ao iniciar sessão WebRTC: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
  },
  
  /**
   * Inicia a gravação de áudio para uma sessão
   * @param {Object} req - Requisição Express
   * @param {Object} res - Resposta Express
   */
  async startRecording(req, res) {
    try {
      const { sessionId } = req.params;
      
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'ID da sessão não fornecido'
        });
      }
      
      logger.info(`Iniciando gravação para sessão ${sessionId}`);
      
      const outputFile = await webRTCService.startRecording(sessionId);
      
      if (!outputFile) {
        return res.status(500).json({
          success: false,
          message: 'Falha ao iniciar gravação'
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'Gravação iniciada com sucesso',
        outputFile
      });
    } catch (error) {
      logger.error(`Erro ao iniciar gravação: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
  },
  
  /**
   * Para a gravação de áudio e retorna a transcrição
   * @param {Object} req - Requisição Express
   * @param {Object} res - Resposta Express
   */
  async stopRecording(req, res) {
    try {
      const { sessionId } = req.params;
      
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'ID da sessão não fornecido'
        });
      }
      
      logger.info(`Parando gravação para sessão ${sessionId}`);
      
      const result = await webRTCService.stopRecording(sessionId);
      
      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'Nenhuma gravação ativa encontrada para esta sessão'
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'Gravação finalizada com sucesso',
        data: {
          outputFile: result.outputFile,
          duration: result.duration,
          transcription: result.transcription
        }
      });
    } catch (error) {
      logger.error(`Erro ao parar gravação: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
  },
  
  /**
   * Transcreve o áudio atual sem parar a gravação
   * @param {Object} req - Requisição Express
   * @param {Object} res - Resposta Express
   */
  async transcribeCurrentAudio(req, res) {
    try {
      const { sessionId } = req.params;
      
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'ID da sessão não fornecido'
        });
      }
      
      logger.info(`Transcrevendo áudio atual da sessão ${sessionId}`);
      
      const result = await webRTCService.transcribeCurrentAudio(sessionId);
      
      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'Nenhuma gravação ativa encontrada para esta sessão ou erro ao transcrever'
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'Transcrição concluída com sucesso',
        data: {
          duration: result.duration,
          transcription: result.transcription,
          timestamp: result.timestamp
        }
      });
    } catch (error) {
      logger.error(`Erro ao transcrever áudio atual: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
  },
  
  /**
   * Lista todas as sessões WebRTC ativas
   * @param {Object} req - Requisição Express
   * @param {Object} res - Resposta Express
   */
  getActiveSessions(req, res) {
    try {
      const sessions = webRTCService.getActiveSessions();
      
      return res.status(200).json({
        success: true,
        sessions
      });
    } catch (error) {
      logger.error(`Erro ao listar sessões ativas: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
  },
  
  /**
   * Encerra uma sessão WebRTC
   * @param {Object} req - Requisição Express
   * @param {Object} res - Resposta Express
   */
  async closeSession(req, res) {
    try {
      const { sessionId } = req.params;
      
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'ID da sessão não fornecido'
        });
      }
      
      logger.info(`Encerrando sessão WebRTC ${sessionId}`);
      
      await webRTCService.closeSession(sessionId);
      
      return res.status(200).json({
        success: true,
        message: 'Sessão WebRTC encerrada com sucesso'
      });
    } catch (error) {
      logger.error(`Erro ao encerrar sessão WebRTC: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
  },
  
  /**
   * Registra um participante explicitamente na sessão WebRTC
   * @param {Object} req - Requisição Express
   * @param {Object} res - Resposta Express
   */
  async registerParticipant(req, res) {
    try {
      const { sessionId, participantId } = req.params;
      
      if (!sessionId || !participantId) {
        return res.status(400).json({
          success: false,
          message: 'IDs da sessão e do participante são obrigatórios'
        });
      }
      
      logger.info(`Registrando participante ${participantId} na sessão WebRTC ${sessionId}`);
      
      const result = await webRTCService.registerParticipant(sessionId, participantId);
      
      if (!result) {
        return res.status(500).json({
          success: false,
          message: 'Falha ao registrar participante na sessão WebRTC'
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'Participante registrado com sucesso na sessão WebRTC',
        sessionId,
        participantId
      });
    } catch (error) {
      logger.error(`Erro ao registrar participante na sessão WebRTC: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor',
        error: error.message
      });
    }
  }
};

module.exports = webRTCController; 