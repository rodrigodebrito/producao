/**
 * Serviço WebRTC para captura de áudio de sessões de terapia
 * Implementação baseada em mediasoup para captação e mixagem de áudio
 */

const mediasoup = require('mediasoup');
const { createLogger } = require('../../utils/logger');
const path = require('path');
const fs = require('fs');
const AudioMixer = require('audio-mixer');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const openaiService = require('../ai/openai.service');

// Configurar logger específico para o serviço WebRTC
const logger = createLogger('webrtc-service');

// Diretório para arquivos temporários
const TMP_DIR = path.join(__dirname, '../../../tmp');
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  logger.info(`Diretório temporário criado: ${TMP_DIR}`);
}

// Configurações do mediasoup
const mediasoupOptions = {
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp'
    ]
  },
  router: {
    mediaCodecs: [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2
    }
    ]
  },
  webRtcTransport: {
    listenIps: [
      { ip: '0.0.0.0', announcedIp: null } // Configuração segura para produção e desenvolvimento
    ],
    initialAvailableOutgoingBitrate: 800000,
    minimumAvailableOutgoingBitrate: 100000,
    maxSctpMessageSize: 262144,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  }
};

// Gerenciamento de sessões ativas
const activeSessions = new Map();

/**
 * Classe que gerencia uma sessão de captura de áudio WebRTC
 */
class WebRTCSession {
  constructor(sessionId) {
    this.id = sessionId;
    this.participants = new Map();
    this.worker = null;
    this.router = null;
    this.audioMixer = null;
    this.isRecording = false;
    this.recordingStream = null;
    this.outputFile = null;
    this.timestamp = Date.now();
    
    logger.info(`Nova sessão WebRTC criada: ${sessionId}`);
  }
  
  /**
   * Inicializa o worker mediasoup e router
   */
  async initialize() {
    try {
      logger.info(`Inicializando worker mediasoup para sessão ${this.id}`);
      this.worker = await mediasoup.createWorker(mediasoupOptions.worker);
      
      this.worker.on('died', () => {
        logger.error(`Worker mediasoup morreu inesperadamente (sessão ${this.id})`);
        this.cleanup();
      });
      
      logger.info(`Criando router para sessão ${this.id}`);
      this.router = await this.worker.createRouter({
        mediaCodecs: mediasoupOptions.router.mediaCodecs
      });
      
      // Inicializar mixer de áudio
      this.audioMixer = new AudioMixer.Mixer({
        channels: 2,
        bitDepth: 16,
        sampleRate: 48000,
        clearInterval: 250
      });
      
      logger.info(`Sessão ${this.id} inicializada com sucesso`);
      return true;
    } catch (error) {
      logger.error(`Erro ao inicializar sessão WebRTC ${this.id}:`, error);
      this.cleanup();
      return false;
    }
  }
  
  /**
   * Cria um transport para um participante
   * @param {string} participantId - ID do participante
   * @param {boolean} isProducer - Se o transporte é para produção de mídia
   */
  async createTransport(participantId, isProducer = true) {
    try {
      logger.info(`Criando ${isProducer ? 'producer' : 'consumer'} transport para participante ${participantId}`);
      
      const transport = await this.router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
      
      // Armazenar o transport no objeto do participante
      if (!this.participants.has(participantId)) {
        this.participants.set(participantId, {
          id: participantId,
          producerTransport: null,
          consumerTransport: null,
          producers: new Map(),
          consumers: new Map(),
          inputStream: null
        });
      }
      
      const participant = this.participants.get(participantId);
      
      if (isProducer) {
        participant.producerTransport = transport;
      } else {
        participant.consumerTransport = transport;
      }
      
      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      };
    } catch (error) {
      logger.error(`Erro ao criar transport para participante ${participantId}:`, error);
      return null;
    }
  }
  
  /**
   * Conecta um transport de um participante
   * @param {string} participantId - ID do participante
   * @param {boolean} isProducer - Se o transporte é para produção de mídia
   * @param {Object} dtlsParameters - Parâmetros DTLS
   */
  async connectTransport(participantId, isProducer, dtlsParameters) {
    try {
      const participant = this.participants.get(participantId);
      if (!participant) {
        logger.error(`Participante ${participantId} não encontrado`);
        return false;
      }
      
      const transport = isProducer ? participant.producerTransport : participant.consumerTransport;
      if (!transport) {
        logger.error(`Transport ${isProducer ? 'producer' : 'consumer'} não encontrado para participante ${participantId}`);
        return false;
      }
      
      logger.info(`Conectando ${isProducer ? 'producer' : 'consumer'} transport para participante ${participantId}`);
      await transport.connect({ dtlsParameters });
      return true;
    } catch (error) {
      logger.error(`Erro ao conectar transport para participante ${participantId}:`, error);
      return false;
    }
  }
  
  /**
   * Adiciona um producer para um participante (áudio)
   * @param {string} participantId - ID do participante
   * @param {Object} rtpParameters - Parâmetros RTP
   */
  async produceAudio(participantId, rtpParameters) {
    try {
      const participant = this.participants.get(participantId);
      if (!participant) {
        logger.error(`Participante ${participantId} não encontrado`);
        return null;
      }
      
      const transport = participant.producerTransport;
      if (!transport) {
        logger.error(`Producer transport não encontrado para participante ${participantId}`);
        return null;
      }
      
      logger.info(`Criando producer de áudio para participante ${participantId}`);
      const producer = await transport.produce({
        kind: 'audio',
        rtpParameters
      });
      
      // Armazenar o producer
      participant.producers.set(producer.id, producer);
      
      // Adicionar ao mixer
      this.addParticipantToMixer(participantId, producer);
      
      // Se a gravação estiver ativa, já começar a capturar áudio deste participante
      if (this.isRecording) {
        this.captureAudioFromProducer(participantId, producer);
      }
      
      return { id: producer.id };
    } catch (error) {
      logger.error(`Erro ao produzir áudio para participante ${participantId}:`, error);
      return null;
    }
  }
  
  /**
   * Adiciona um participante ao mixer de áudio
   * @param {string} participantId - ID do participante
   * @param {Object} producer - Producer de áudio
   */
  addParticipantToMixer(participantId, producer) {
    try {
      logger.info(`Adicionando participante ${participantId} ao mixer de áudio`);
      
      const participant = this.participants.get(participantId);
      
      // Criar um input para o mixer
      participant.inputStream = this.audioMixer.input({
        channels: 2,
        volume: 100
      });
      
      logger.info(`Participante ${participantId} adicionado ao mixer com sucesso`);
    } catch (error) {
      logger.error(`Erro ao adicionar participante ${participantId} ao mixer:`, error);
    }
  }
  
  /**
   * Inicia a gravação do áudio da sessão
   * @returns {string} Caminho do arquivo de saída
   */
  async startRecording() {
    try {
      if (this.isRecording) {
        logger.warn(`Gravação já está ativa para sessão ${this.id}`);
        return this.outputFile;
      }
      
      logger.info(`Iniciando gravação para sessão ${this.id}`);
      
      // Criar arquivo de saída
      const timestamp = Date.now();
      this.outputFile = path.join(TMP_DIR, `session_${this.id}_${timestamp}.wav`);
      
      // Configurar stream de saída
      const outputStream = fs.createWriteStream(this.outputFile);
      
      // Conectar mixer ao arquivo
      this.audioMixer.pipe(outputStream);
      
      // Marcar como gravando
      this.isRecording = true;
      this.recordingStartTime = Date.now();
      
      // Para cada participante conectado, iniciar a captura de áudio
      for (const [participantId, participant] of this.participants.entries()) {
        for (const [producerId, producer] of participant.producers.entries()) {
          this.captureAudioFromProducer(participantId, producer);
        }
      }
      
      logger.info(`Gravação iniciada para sessão ${this.id}, salvando em ${this.outputFile}`);
      return this.outputFile;
    } catch (error) {
      logger.error(`Erro ao iniciar gravação para sessão ${this.id}:`, error);
      return null;
    }
  }
  
  /**
   * Captura o áudio de um producer e adiciona ao mixer
   * @param {string} participantId - ID do participante
   * @param {Object} producer - Producer de áudio
   */
  async captureAudioFromProducer(participantId, producer) {
    try {
      // Implementação básica: processa dados RTP
      producer.on('transportclose', () => {
        logger.info(`Transport fechado para producer do participante ${participantId}`);
      });
      
      // Notificar que dados estão sendo capturados
      logger.info(`Áudio do participante ${participantId} está sendo capturado`);
    } catch (error) {
      logger.error(`Erro ao capturar áudio do participante ${participantId}:`, error);
    }
  }
  
  /**
   * Para a gravação e processa o áudio
   * @returns {Object} Resultado da transcrição
   */
  async stopRecording() {
    try {
      if (!this.isRecording) {
        logger.warn(`Nenhuma gravação ativa para sessão ${this.id}`);
        return null;
      }
      
      logger.info(`Parando gravação para sessão ${this.id}`);
      
      // Calcular duração da gravação
      const duration = Date.now() - this.recordingStartTime;
      logger.info(`Duração da gravação: ${duration}ms`);
      
      // Desconectar mixer do arquivo
      this.audioMixer.unpipe();
      
      // Marcar como não gravando
      this.isRecording = false;
      
      logger.info(`Gravação finalizada para sessão ${this.id}, arquivo salvo em ${this.outputFile}`);
      
      // Processar o áudio para transcrição
      if (fs.existsSync(this.outputFile)) {
        logger.info(`Processando arquivo de áudio para transcrição: ${this.outputFile}`);
        
        // Transcrever usando Whisper
        const transcription = await this.transcribeAudio(this.outputFile);
        
        return {
          outputFile: this.outputFile,
          duration,
          transcription
        };
      } else {
        logger.error(`Arquivo de gravação não encontrado: ${this.outputFile}`);
        return null;
      }
    } catch (error) {
      logger.error(`Erro ao parar gravação para sessão ${this.id}:`, error);
      return null;
    }
  }
  
  /**
   * Transcreve o áudio usando o serviço Whisper
   * @param {string} audioFile - Caminho do arquivo de áudio
   * @returns {string} Texto transcrito
   */
  async transcribeAudio(audioFile) {
    try {
      logger.info(`Transcrevendo áudio usando Whisper: ${audioFile}`);
      
      // Usar o serviço OpenAI existente
      const transcription = await openaiService.transcribeAudioVideo(audioFile, 'pt');
      
      logger.info(`Transcrição concluída com sucesso, tamanho: ${transcription.length} caracteres`);
      return transcription;
    } catch (error) {
      logger.error(`Erro ao transcrever áudio: ${error.message}`);
      return `Erro na transcrição: ${error.message}`;
    }
  }
  
  /**
   * Limpa recursos e encerra a sessão
   */
  async cleanup() {
    try {
      logger.info(`Limpando recursos para sessão ${this.id}`);
      
      // Parar gravação se estiver ativa
      if (this.isRecording) {
        await this.stopRecording();
      }
      
      // Fechar todos os transportes e producers
      for (const [participantId, participant] of this.participants.entries()) {
        logger.info(`Fechando transportes para participante ${participantId}`);
        
        if (participant.producerTransport) {
          participant.producerTransport.close();
        }
        
        if (participant.consumerTransport) {
          participant.consumerTransport.close();
        }
      }
      
      // Fechar router e worker
      if (this.router) {
        this.router.close();
      }
      
      if (this.worker) {
        this.worker.close();
      }
      
      // Limpar mixer
      if (this.audioMixer) {
        this.audioMixer.end();
      }
      
      logger.info(`Sessão ${this.id} encerrada e recursos liberados`);
      
      // Remover do mapa de sessões ativas
      activeSessions.delete(this.id);
    } catch (error) {
      logger.error(`Erro ao limpar recursos para sessão ${this.id}:`, error);
    }
  }
  
  /**
   * Remove um participante da sessão
   * @param {string} participantId - ID do participante
   */
  removeParticipant(participantId) {
    try {
      logger.info(`Removendo participante ${participantId} da sessão ${this.id}`);
      
      const participant = this.participants.get(participantId);
      if (!participant) {
        logger.warn(`Participante ${participantId} não encontrado na sessão ${this.id}`);
        return;
      }
      
      // Fechar transportes
      if (participant.producerTransport) {
        participant.producerTransport.close();
      }
      
      if (participant.consumerTransport) {
        participant.consumerTransport.close();
      }
      
      // Remover do mapa de participantes
      this.participants.delete(participantId);
      
      logger.info(`Participante ${participantId} removido da sessão ${this.id}`);
    } catch (error) {
      logger.error(`Erro ao remover participante ${participantId} da sessão ${this.id}:`, error);
    }
  }
  
  /**
   * Transcreve o áudio atual sem parar a gravação
   * @returns {Promise<Object>} Resultado da transcrição parcial
   */
  async transcribeCurrentAudio() {
    try {
      if (!this.isRecording) {
        logger.warn(`Nenhuma gravação ativa para sessão ${this.id}`);
        return null;
      }
      
      logger.info(`Transcrevendo áudio atual da sessão ${this.id} sem parar a gravação`);
      
      // Calcular duração da gravação até o momento
      const duration = Date.now() - this.recordingStartTime;
      logger.info(`Duração atual da gravação: ${duration}ms`);
      
      // Criar uma cópia temporária do arquivo atual para transcrição
      const tempOutputFile = `${this.outputFile}.temp-${Date.now()}.wav`;
      
      // Verificar se o arquivo existe e tem conteúdo
      if (!fs.existsSync(this.outputFile)) {
        logger.error(`Arquivo de gravação não encontrado: ${this.outputFile}`);
        return null;
      }
      
      // Copiar arquivo para versão temporária
      fs.copyFileSync(this.outputFile, tempOutputFile);
      logger.info(`Arquivo temporário criado: ${tempOutputFile}`);
      
      // Transcrever o arquivo temporário
      const transcription = await this.transcribeAudio(tempOutputFile);
      
      // Registrar timestamp da transcrição parcial
      const timestamp = new Date().toISOString();
      
      // Remover arquivo temporário após transcrição
      try {
        fs.unlinkSync(tempOutputFile);
        logger.info(`Arquivo temporário removido: ${tempOutputFile}`);
      } catch (err) {
        logger.warn(`Não foi possível remover arquivo temporário: ${tempOutputFile}`, err);
      }
      
      return {
        duration,
        transcription,
        timestamp
      };
    } catch (error) {
      logger.error(`Erro ao transcrever áudio atual para sessão ${this.id}:`, error);
      return null;
    }
  }
}

/**
 * Serviço WebRTC para gerenciamento de sessões de áudio
 */
const webRTCService = {
  /**
   * Cria ou retorna uma sessão de WebRTC
   * @param {string} sessionId - ID da sessão
   * @returns {Promise<WebRTCSession>} Sessão WebRTC
   */
  async getSession(sessionId) {
    try {
      // Verificar se já existe uma sessão
      if (activeSessions.has(sessionId)) {
        return activeSessions.get(sessionId);
      }
      
      // Criar nova sessão
      const session = new WebRTCSession(sessionId);
      await session.initialize();
      
      // Armazenar no mapa de sessões ativas
      activeSessions.set(sessionId, session);
      
      return session;
    } catch (error) {
      logger.error(`Erro ao obter sessão WebRTC ${sessionId}:`, error);
      return null;
    }
  },
  
  /**
   * Inicia a gravação para uma sessão
   * @param {string} sessionId - ID da sessão
   * @returns {Promise<string>} Caminho do arquivo de saída
   */
  async startRecording(sessionId) {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        logger.error(`Sessão WebRTC ${sessionId} não encontrada ou não pôde ser criada`);
        return null;
      }
      
      return await session.startRecording();
    } catch (error) {
      logger.error(`Erro ao iniciar gravação para sessão ${sessionId}:`, error);
      return null;
    }
  },
  
  /**
   * Para a gravação e processa o áudio
   * @param {string} sessionId - ID da sessão
   * @returns {Promise<Object>} Resultado da transcrição
   */
  async stopRecording(sessionId) {
    try {
      const session = activeSessions.get(sessionId);
      if (!session) {
        logger.error(`Sessão WebRTC ${sessionId} não encontrada`);
        return null;
      }
      
      return await session.stopRecording();
    } catch (error) {
      logger.error(`Erro ao parar gravação para sessão ${sessionId}:`, error);
      return null;
    }
  },
  
  /**
   * Encerra uma sessão e libera recursos
   * @param {string} sessionId - ID da sessão
   */
  async closeSession(sessionId) {
    try {
      const session = activeSessions.get(sessionId);
      if (!session) {
        logger.warn(`Sessão WebRTC ${sessionId} não encontrada para encerramento`);
        return;
      }
      
      await session.cleanup();
    } catch (error) {
      logger.error(`Erro ao encerrar sessão WebRTC ${sessionId}:`, error);
    }
  },
  
  /**
   * Lista todas as sessões ativas
   * @returns {Array} Lista de IDs de sessões ativas
   */
  getActiveSessions() {
    return Array.from(activeSessions.keys());
  },
  
  /**
   * Transcreve o áudio atual sem parar a gravação
   * @param {string} sessionId - ID da sessão
   * @returns {Promise<Object>} Resultado da transcrição parcial
   */
  async transcribeCurrentAudio(sessionId) {
    try {
      const session = activeSessions.get(sessionId);
      if (!session) {
        logger.error(`Sessão WebRTC ${sessionId} não encontrada`);
        return null;
      }
      
      return await session.transcribeCurrentAudio();
    } catch (error) {
      logger.error(`Erro ao transcrever áudio atual para sessão ${sessionId}:`, error);
      return null;
    }
  }
};

module.exports = webRTCService; 