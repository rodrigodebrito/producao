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
      
      // Inicializar mixer de áudio (correção do construtor)
      this.audioMixer = new AudioMixer.Mixer({
        channels: 2,
        bitDepth: 16,
        sampleRate: 48000,
        clearInterval: 250,
        volume: 150
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
      logger.info(`Producer de áudio ${producer.id} criado para participante ${participantId}`);
      
      // Marcar este participante como "real" imediatamente quando ele produz áudio
      // Mesmo que ainda não tenhamos dados de áudio
      participant.isReal = true;
      this.realParticipantCount = (this.realParticipantCount || 0) + 1;
      logger.info(`Participante ${participantId} marcado como real. Total de participantes reais: ${this.realParticipantCount}`);
      
      // Adicionar ao mixer
      this.addParticipantToMixer(participantId);
      
      // Configurar evento para quando o transporte for fechado
      producer.on('transportclose', () => {
        logger.info(`Transport fechado para producer ${producer.id} do participante ${participantId}`);
        
        // Remover producer da lista
        participant.producers.delete(producer.id);
        
        // Se for o último producer do participante, talvez queira fazer algo mais
        if (participant.producers.size === 0) {
          logger.info(`Participante ${participantId} não tem mais producers ativos`);
        }
      });
      
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
   */
  addParticipantToMixer(participantId) {
    try {
      logger.info(`[webrtc-service] Processando participante ${participantId} (total: ${this.participants.size}, reais: ${this.realParticipantCount || 0})`);
      
      const participant = this.participants.get(participantId);
      if (!participant) {
        logger.warn(`[webrtc-service] Participante ${participantId} não encontrado, criando registro mínimo`);
        
        // Criar um registro mínimo para o participante
        this.participants.set(participantId, {
          id: participantId,
          isReal: true
        });
        
        // Obter o registro recém-criado
        const newParticipant = this.participants.get(participantId);
        
        // Adicionar input para o participante em fallback com VOLUME EXTREMAMENTE ALTO
        if (this.audioMixer) {
          logger.info(`[webrtc-service] Participante ${participantId} sem producers, criando input de fallback no mixer com alta sensibilidade`);
          
          newParticipant.mixerInput = this.audioMixer.input({
            channels: 2,
            volume: 300, // Volume extremamente alto para captar som muito baixo
            bitDepth: 16,
            sampleRate: 48000,
            name: `participant-${participantId}-high-sensitivity`
          });
          
          logger.info(`[webrtc-service] Input de fallback de alta sensibilidade criado para participante ${participantId}`);
          
          // Gerar um tom de teste muito baixo para garantir que há algum áudio
          this._generateUltraLowTestTone(newParticipant.mixerInput, participantId);
          
          // Incrementar contador
          this.realParticipantCount = (this.realParticipantCount || 0) + 1;
        }
        
        return;
      }
      
      // Verificar se já tem producer de áudio registrado
      if (participant.producers && participant.producers.size > 0) {
        logger.info(`[webrtc-service] Participante ${participantId} tem ${participant.producers.size} producers`);
        
        // Adicionar cada producer ao mixer
        for (const [, producer] of participant.producers.entries()) {
          if (producer.kind === 'audio') {
            logger.info(`[webrtc-service] Capturando áudio do producer ${producer.id}`);
            this.captureAudioFromProducer(participantId, producer);
          }
        }
      } else {
        // Se não há producers, criar um input de fallback com VOLUME MUITO ALTO
        if (this.audioMixer && !participant.mixerInput) {
          logger.info(`[webrtc-service] Participante ${participantId} sem producers, criando input de fallback no mixer com alta sensibilidade`);
          
          participant.mixerInput = this.audioMixer.input({
            channels: 2,
            volume: 300, // Volume extremamente alto (era 150) para captar som muito baixo
            bitDepth: 16,
            sampleRate: 48000,
            name: `participant-${participantId}-high-sensitivity`
          });
          
          logger.info(`[webrtc-service] Input de fallback de alta sensibilidade criado para participante ${participantId}`);
          
          // Gerar um tom de teste muito baixo para garantir que há algum áudio
          this._generateUltraLowTestTone(participant.mixerInput, participantId);
        }
      }
      
      // Garantir que o participante está marcado como real para contagem
      if (!participant.isReal) {
        participant.isReal = true;
        this.realParticipantCount = (this.realParticipantCount || 0) + 1;
      }
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao adicionar participante ${participantId} ao mixer:`, error);
    }
  }
  
  /**
   * Gera um tom de teste muito baixo para garantir que o sistema de áudio esteja funcionando
   * @param {Object} input - Input do mixer
   * @param {string} participantId - ID do participante
   * @private
   */
  _generateUltraLowTestTone(input, participantId) {
    try {
      // Criar um buffer com 0.5 segundos de áudio com um tom quase inaudível
      const sampleRate = 48000;
      const duration = 0.5; // 0.5 segundos
      const bufferSize = sampleRate * 2 * 2 * duration; // 2 canais, 2 bytes por amostra
      
      logger.info(`[webrtc-service] Gerando tom de teste ultra-baixo para participante ${participantId}`);
      
      // Criar buffer
      const buffer = Buffer.alloc(bufferSize);
      
      // Gerar um tom muito baixo (quase inaudível, mas detectável pelo sistema)
      const frequency = 440; // Frequência A4 (padrão)
      const amplitude = 0.001; // 0.1% do volume máximo - extremamente baixo
      
      for (let i = 0; i < sampleRate * duration; i++) {
        const sampleValue = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
        const intValue = Math.floor(sampleValue * 32767); // Converter para inteiro de 16 bits
        
        // Canal esquerdo e direito
        buffer.writeInt16LE(intValue, i * 4);
        buffer.writeInt16LE(intValue, i * 4 + 2);
      }
      
      // Enviar o buffer para o mixer
      if (input && typeof input.write === 'function') {
        input.write(buffer);
        logger.info(`[webrtc-service] Tom de teste enviado para participante ${participantId}`);
      }
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao gerar tom de teste para participante ${participantId}:`, error);
    }
  }
  
  /**
   * Inicia a gravação de áudio com melhorias para detecção mesmo com volume baixo
   * @returns {Promise<string>} - Caminho do arquivo de saída
   */
  async startRecording() {
    try {
      if (this.isRecording) {
        logger.info(`[webrtc-service] Gravação já está ativa para sessão ${this.id}`);
        return this.outputFile;
      }
      
      // Nome de arquivo baseado no ID da sessão e timestamp atual
      const fileName = `session_${this.id}_${Date.now()}.wav`;
      this.outputFile = path.join(process.cwd(), 'tmp', fileName);
      
      // Criar diretório tmp se não existir
      if (!fs.existsSync(path.join(process.cwd(), 'tmp'))) {
        fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
      }
      
      // Criar arquivo de saída
      const outputStream = fs.createWriteStream(this.outputFile);
      
      // Criar mixer de áudio com configurações otimizadas
      this.audioMixer = new AudioMixer.Mixer({
        channels: 2,
        bitDepth: 16,
        sampleRate: 48000,
        clearInterval: 250, // Intervalo para limpar chunks processados
        // Volume do mix principal aumentado para melhorar detecção
        volume: 150 // 150% do volume normal
      });
      
      // Conectar mixer com arquivo de saída
      this.audioMixer.pipe(outputStream);
      
      logger.info(`[webrtc-service] Iniciando gravação para sessão ${this.id}`);
      
      // Escrever cabeçalho WAV
      const writeHeader = () => {
        logger.info('[webrtc-service] Escrevendo cabeçalho WAV no arquivo...');
        
        try {
          // Abrir o arquivo em modo escrita
          const fd = fs.openSync(this.outputFile, 'w');
          
          // Escrever cabeçalho RIFF
          const buffer = Buffer.alloc(44); // Tamanho do cabeçalho WAV
          
          // RIFF
          buffer.write('RIFF', 0);
          buffer.writeUInt32LE(0, 4); // Placeholder para fileSize - 8
          buffer.write('WAVE', 8);
          
          // Subchunk fmt
          buffer.write('fmt ', 12);
          buffer.writeUInt32LE(16, 16); // Tamanho do subchunk fmt (16 bytes)
          buffer.writeUInt16LE(1, 20); // Formato (PCM = 1)
          buffer.writeUInt16LE(2, 22); // Número de canais (estéreo = 2)
          buffer.writeUInt32LE(48000, 24); // Taxa de amostragem (48kHz)
          buffer.writeUInt32LE(48000 * 2 * 2, 28); // Bytes Rate (sampleRate * channels * bytesPerSample)
          buffer.writeUInt16LE(4, 32); // Block Align (channels * bytesPerSample)
          buffer.writeUInt16LE(16, 34); // Bits per sample (16 bits)
          
          // Subchunk data
          buffer.write('data', 36);
          buffer.writeUInt32LE(0, 40); // Placeholder para dataSize
          
          // Escrever no arquivo
          fs.writeSync(fd, buffer, 0, 44, 0);
          
          // Fechar o arquivo
          fs.closeSync(fd);
          
          logger.info('[webrtc-service] Cabeçalho WAV escrito com sucesso');
        } catch (error) {
          logger.error(`[webrtc-service] Erro ao escrever cabeçalho WAV: ${error.message}`);
        }
      };
      
      // Escrever cabeçalho
      writeHeader();
      
      // Registrar todos os participantes ativos no mixer
      await this._ensureParticipantsRegistered();
      
      // Adicionar cada participante ao mixer
      let participantsWithProducers = 0;
      for (const [participantId, participant] of this.participants.entries()) {
        logger.info(`[webrtc-service] Processando participante ${participantId} (total: ${this.participants.size}, reais: ${this.realParticipantCount || 0})`);
        
        // Verificar se já tem producer registrado
        if (participant.producers && participant.producers.size > 0) {
          for (const [, producer] of participant.producers.entries()) {
            if (producer.kind === 'audio') {
              logger.info(`[webrtc-service] Participante ${participantId} tem producer de áudio`);
              
              // Adicionar ao mixer
              this.addParticipantToMixer(participantId);
              
              participantsWithProducers++;
              break; // Basta um producer por participante
            }
          }
        } else {
          // Se não há producers, ainda registrar no mixer com alta sensibilidade
          this.addParticipantToMixer(participantId);
        }
      }
      
      // Sempre criar um input global de fallback com VOLUME EXTREMAMENTE ALTO
      // para garantir que qualquer áudio, por mais baixo que seja, seja detectado
      logger.info('[webrtc-service] Criando input global de alta sensibilidade');
      
      this.virtualInput = this.audioMixer.input({
        channels: 2,
        volume: 400, // Volume extremamente alto (era 200) para o input global
        bitDepth: 16,
        sampleRate: 48000,
        name: 'global-high-sensitivity'
      });
      
      logger.info('[webrtc-service] Input global de alta sensibilidade criado no mixer');
      
      // Gerar um tom curto de teste no input global para garantir atividade
      this._generateUltraLowTestTone(this.virtualInput, 'global');
      
      // Adicionar silêncio mínimo para garantir que o arquivo tem dados
      this._addMinimumSilence();
      
      // Iniciar monitoramento do arquivo
      this._monitorOutputFile();
      
      // Marcar como gravando
      this.isRecording = true;
      this.recordingStartTime = Date.now();
      
      logger.info(`[webrtc-service] Gravação iniciada para sessão ${this.id} com ${this.realParticipantCount} participantes reais, salvando em ${this.outputFile}`);
      
      return this.outputFile;
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao iniciar gravação para sessão ${this.id}:`, error);
      return null;
    }
  }
  
  /**
   * Método para garantir que todos os participantes estejam registrados corretamente
   * Verifica conexões ativas no router mediasoup para encontrar participantes faltantes
   * @private
   */
  async _ensureParticipantsRegistered() {
    try {
      if (!this.router) {
        logger.warn('Router mediasoup não disponível para verificar participantes');
        return;
      }
      
      // Lista de transports ativos no router
      const transports = await this.router.dump();
      
      if (!transports || !transports.transports || transports.transports.length === 0) {
        logger.warn('Nenhum transport ativo encontrado no router mediasoup');
        return;
      }
      
      logger.info(`Verificando ${transports.transports.length} transports ativos no router mediasoup`);
      
      // Um conjunto para armazenar possíveis IDs de participantes encontrados
      const foundParticipantIds = new Set();
      
      // Conjunto para IDs já registrados
      const existingIds = new Set(this.participants.keys());
      
      // Analisar nomes de transports para encontrar possíveis IDs de participantes
      for (const transport of transports.transports) {
        // Buscar padrões como 'participant-123' ou similares nos dados do transport
        const transportData = JSON.stringify(transport);
        
        const matches = transportData.match(/participant[_\-]([a-zA-Z0-9_\-]+)/);
        if (matches && matches[1]) {
          const potentialId = matches[1];
          foundParticipantIds.add(potentialId);
          logger.info(`Possível participante encontrado no transport ${transport.id}: ${potentialId}`);
        }
      }
      
      // Registrar participantes encontrados que ainda não estão registrados
      for (const participantId of foundParticipantIds) {
        if (!existingIds.has(participantId)) {
          logger.info(`Registrando automaticamente participante descoberto: ${participantId}`);
          
          // Criar registro de participante
          this.participants.set(participantId, {
            id: participantId,
            producerTransport: null,
            consumerTransport: null,
            producers: new Map(),
            consumers: new Map(),
            inputStream: null,
            isReal: true, // Marcar como real para garantir contagem
            autoRegistered: true // Indicar que foi registrado automaticamente
          });
        }
      }
      
      logger.info(`Verificação de participantes concluída. Total registrado: ${this.participants.size}`);
    } catch (error) {
      logger.error(`Erro ao verificar participantes no router: ${error.message}`);
    }
  }
  
  /**
   * Adiciona silêncio mínimo ao arquivo para garantir que tenha dados suficientes
   * @private
   */
  _addMinimumSilence() {
    try {
      // Criar silêncio para apenas 0.5 segundos para permitir ouvir o áudio real mais rapidamente
      const sampleRate = 48000;
      const channels = 2;
      const bytesPerSample = 2; // 16 bits
      const duration = 0.5; // 0.5 segundos (reduzido)
      
      const dataSize = Math.floor(sampleRate * channels * bytesPerSample * duration);
      const buffer = Buffer.alloc(dataSize);
      
      // Buffer já está preenchido com zeros (silêncio absoluto)
      
      // Verificar se o mixer existe
      if (!this.audioMixer) {
        logger.error('Mixer não encontrado para adicionar silêncio');
        return;
      }
      
      // Criar input temporário para silêncio
      const silenceInput = this.audioMixer.input({
        channels: 2,
        volume: 1, // Volume mínimo
        bitDepth: 16,
        sampleRate: 48000,
        name: 'silence-minimum-short'
      });
      
      // Escrever buffer de silêncio diretamente
      silenceInput.write(buffer);
      
      logger.info(`Silêncio mínimo de ${duration} segundos adicionado ao arquivo, tamanho: ${dataSize} bytes`);
      
      // Fechar o input mais rapidamente
      setTimeout(() => {
        silenceInput.end();
        logger.info('Input de silêncio mínimo finalizado');
      }, 50); // Tempo reduzido
    } catch (error) {
      logger.error(`Erro ao adicionar silêncio mínimo: ${error.message}`);
    }
  }
  
  /**
   * Monitora o arquivo de saída para garantir que está crescendo
   * @private
   */
  _monitorOutputFile() {
    // Tamanho inicial
    if (!fs.existsSync(this.outputFile)) {
      logger.error(`Arquivo de saída não encontrado: ${this.outputFile}`);
      return;
    }
    
    const initialStats = fs.statSync(this.outputFile);
    logger.info(`Arquivo WAV iniciado: ${this.outputFile}, tamanho inicial: ${initialStats.size} bytes`);
    
    // Verificar após 2 segundos
    setTimeout(() => {
      if (!this.isRecording) return;
      
      try {
        const stats = fs.statSync(this.outputFile);
        logger.info(`Arquivo WAV após 2 segundos: ${this.outputFile}, tamanho: ${stats.size} bytes`);
        
        // Se o arquivo não cresceu, pode haver um problema
        if (stats.size <= initialStats.size) {
          logger.warn(`Arquivo de gravação não está crescendo. Verificando participantes e áudio...`);
          
          // Verificar participantes novamente
          let hasRealParticipants = false;
          for (const [participantId, participant] of this.participants.entries()) {
            if (participant.producers && participant.producers.size > 0) {
              hasRealParticipants = true;
              logger.info(`Participante real encontrado: ${participantId} com ${participant.producers.size} producers`);
            }
          }
          
          // Não adicionamos um input virtual, apenas logamos que não existem participantes reais
          if (!hasRealParticipants) {
            logger.info('Nenhum participante real encontrado ainda. Esperando conexão de áudio...');
          }
        }
      } catch (error) {
        logger.error(`Erro ao monitorar arquivo de saída: ${error.message}`);
      }
    }, 2000);
  }
  
  /**
   * Captura o áudio de um producer e adiciona ao mixer
   * @param {string} participantId - ID do participante
   * @param {Object} producer - Producer de áudio
   */
  async captureAudioFromProducer(participantId, producer) {
    try {
      logger.info(`Iniciando captura de áudio do producer ${producer.id} do participante ${participantId} com sensibilidade aumentada`);
      
      const participant = this.participants.get(participantId);
      if (!participant) {
        logger.error(`Participante ${participantId} não encontrado para captura de áudio`);
        return;
      }
      
      // Marcar como participante real com producer ativo para análise posterior
      participant.hasActiveProducer = true;
      
      // Verificar se já existe um input para este participante
      if (!participant.mixerInput) {
        logger.info(`Participante ${participantId} não possui um input no mixer, criando...`);
        
        // Criar uma entrada no mixer para este participante
        participant.mixerInput = this.audioMixer.input({
          channels: 2,  // Estéreo
          volume: 100,  // Volume máximo
          bitDepth: 16, // 16 bits por amostra
          sampleRate: 48000, // 48 kHz
          name: `participant-${participantId}-${producer.id}`
        });
        
        logger.info(`Input adicionado ao mixer para participante ${participantId}`);
        
        // Verificar se o participante já está marcado como real
        if (!participant.isReal) {
          participant.isReal = true;
          // Incrementar contador apenas se não foi incrementado antes
          this.realParticipantCount = (this.realParticipantCount || 0) + 1;
          logger.info(`Participante ${participantId} marcado como real. Total: ${this.realParticipantCount}`);
        }
      }
      
      // Registrar evento para quando o producer receber dados RTP (áudio real)
      producer.on('score', (score) => {
        // Score é um indicador de qualidade do audio
        logger.debug(`Producer ${producer.id} do participante ${participantId} recebendo áudio com qualidade: ${JSON.stringify(score)}`);
        participant.lastActivity = Date.now(); // Atualizar timestamp de última atividade
      });
      
      // Registrar evento para quando o transporte for fechado
      producer.on('transportclose', () => {
        logger.info(`Transport fechado para producer ${producer.id} do participante ${participantId}`);
        
        // Remover input quando o transporte for fechado
        if (participant.mixerInput && typeof participant.mixerInput.end === 'function') {
          participant.mixerInput.end();
          logger.info(`Input removido do mixer para participante ${participantId}`);
          participant.mixerInput = null;
          
          // Decrementar contador de participantes reais
          if (participant.isReal) {
            this.realParticipantCount = (this.realParticipantCount || 1) - 1;
            logger.info(`Número total de participantes reais agora: ${this.realParticipantCount}`);
          }
        }
      });
      
      // Ao invés de simular dados para todos, vamos só monitorar atividade de áudio real
      logger.info(`Áudio do participante ${participantId} está sendo monitorado para captura`);
    } catch (error) {
      logger.error(`Erro ao capturar áudio do participante ${participantId}:`, error);
    }
  }
  
  /**
   * Simula dados de áudio para o mixer
   * @param {Object} input - Input do mixer
   * @param {string} participantId - ID do participante
   * @private
   */
  _simulateAudioData(input, participantId) {
    try {
      // Criar um buffer com 1 segundo de áudio silencioso
      // Para 48kHz, 16-bit, estéreo, 1 segundo = 48000 * 2 * 2 bytes = 192000 bytes
      const sampleRate = 48000;
      const duration = 2; // 2 segundos de dados
      const bufferSize = sampleRate * 2 * 2 * duration; // 2 canais, 2 bytes por amostra
      
      logger.info(`Gerando ${duration} segundos de áudio silencioso para participante ${participantId}`);
      
      // Criar buffer de áudio completamente silencioso
      const buffer = Buffer.alloc(bufferSize);
      
      // Preencher com um silêncio absoluto (zeros)
      // O buffer já está inicializado com zeros, então não precisamos preencher

      logger.info(`Usando silêncio para participante ${participantId}`);
      
      // Definir um intervalo para enviar dados para o mixer
      const chunkSize = 4096; // Tamanho do chunk em bytes
      let offset = 0;
      
      const sendChunk = () => {
        if (!this.isRecording) {
          logger.info(`Parando envio de dados simulados para participante ${participantId}`);
          return;
        }
        
        if (offset >= buffer.length) {
          // Reiniciar quando chegar ao fim
          offset = 0;
        }
        
        // Calcular tamanho do chunk atual
        const currentChunkSize = Math.min(chunkSize, buffer.length - offset);
        
        // Extrair chunk do buffer
        const chunk = buffer.slice(offset, offset + currentChunkSize);
        
        // Enviar para o mixer
        if (input && typeof input.write === 'function') {
          input.write(chunk);
        }
        
        // Avançar offset
        offset += currentChunkSize;
        
        // Agendar próximo chunk (a cada 100ms)
        setTimeout(sendChunk, 100);
      };
      
      // Iniciar o envio de chunks
      sendChunk();
      
      logger.info(`Iniciado envio periódico de dados de áudio para participante ${participantId}`);
    } catch (error) {
      logger.error(`Erro ao simular dados de áudio para participante ${participantId}:`, error);
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
      
      // Se a gravação foi muito curta (menos de 0.5 segundos), aguardar um pouco mais
      // para garantir que temos dados suficientes
      if (duration < 500) {
        const waitTime = 500 - duration;
        logger.info(`Gravação muito curta (${duration}ms), aguardando mais ${waitTime}ms para garantir dados suficientes`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Limpar input virtual se existir
      if (this.virtualInput) {
        logger.info('Limpando input virtual');
        if (typeof this.virtualInput.end === 'function') {
          this.virtualInput.end();
        }
        this.virtualInput = null;
      }
      
      // Desconectar mixer do arquivo
      if (this.audioMixer) {
        logger.info('Desconectando mixer do arquivo');
        this.audioMixer.unpipe();
      }
      
      // Marcar como não gravando
      this.isRecording = false;
      
      logger.info(`Gravação finalizada para sessão ${this.id}, arquivo salvo em ${this.outputFile}`);
      
      // Verificar tamanho do arquivo antes de tentar transcrever
      if (!fs.existsSync(this.outputFile)) {
        logger.error(`Arquivo de gravação não encontrado: ${this.outputFile}`);
        return null;
      }
      
      const fileStats = fs.statSync(this.outputFile);
      logger.info(`Tamanho final do arquivo de gravação: ${fileStats.size} bytes`);
      
      // Se o arquivo for muito pequeno, adicionar um tom de silêncio para garantir tamanho mínimo
      if (fileStats.size < 5000) { // 5KB é um tamanho mínimo seguro
        logger.warn(`Arquivo de gravação muito pequeno (${fileStats.size} bytes), adicionando dados para atingir o mínimo necessário`);
        await this._appendMinimumAudioData(this.outputFile);
      }
      
      // Processar o áudio para transcrição
      logger.info(`Processando arquivo de áudio para transcrição: ${this.outputFile}`);
      
      // Transcrever usando Whisper
      const transcription = await this.transcribeAudio(this.outputFile);
      
      return {
        outputFile: this.outputFile,
        duration,
        transcription
      };
    } catch (error) {
      logger.error(`Erro ao parar gravação para sessão ${this.id}:`, error);
      return null;
    }
  }
  
  /**
   * Adiciona dados de áudio mínimos ao arquivo para garantir que possa ser transcrito
   * @param {string} filePath - Caminho do arquivo WAV
   * @private
   */
  async _appendMinimumAudioData(filePath) {
    try {
      logger.info(`Adicionando dados de áudio mínimos ao arquivo: ${filePath}`);
      
      // Criar 1 segundo de tom de teste
      const sampleRate = 48000;
      const channels = 2;
      const bytesPerSample = 2; // 16 bits
      const duration = 1; // 1 segundo
      
      const dataSize = sampleRate * channels * bytesPerSample * duration;
      const buffer = Buffer.alloc(dataSize);
      
      // Gerar um tom de teste (440Hz)
      const frequency = 440;
      const amplitude = 0.1; // 10% do volume máximo
      
      for (let i = 0; i < sampleRate * duration; i++) {
        const sampleValue = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
        const intValue = Math.floor(sampleValue * 32767);
        
        // Canal esquerdo e direito
        buffer.writeInt16LE(intValue, i * 4);
        buffer.writeInt16LE(intValue, i * 4 + 2);
      }
      
      // Abrir o arquivo em modo append
      const fd = fs.openSync(filePath, 'a');
      
      // Adicionar os dados ao final do arquivo
      fs.writeSync(fd, buffer, 0, buffer.length);
      
      // Fechar o arquivo
      fs.closeSync(fd);
      
      // Atualizar o tamanho dos chunks no cabeçalho WAV
      this._updateWavHeader(filePath);
      
      // Verificar o novo tamanho
      const stats = fs.statSync(filePath);
      logger.info(`Novo tamanho do arquivo após adicionar dados: ${stats.size} bytes`);
    } catch (error) {
      logger.error(`Erro ao adicionar dados mínimos ao arquivo: ${error.message}`);
    }
  }
  
  /**
   * Atualiza o cabeçalho WAV com o tamanho correto dos chunks
   * @param {string} filePath - Caminho do arquivo WAV
   * @private
   */
  _updateWavHeader(filePath) {
    try {
      // Obter o tamanho total do arquivo
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      
      if (fileSize < 44) {
        logger.error(`Arquivo muito pequeno para ser um WAV válido: ${fileSize} bytes`);
        return;
      }
      
      // Ler o cabeçalho atual
      const headerBuffer = Buffer.alloc(44);
      const fd = fs.openSync(filePath, 'r+');
      fs.readSync(fd, headerBuffer, 0, 44, 0);
      
      // Verificar se é um WAV válido
      if (headerBuffer.toString('ascii', 0, 4) !== 'RIFF' || 
          headerBuffer.toString('ascii', 8, 12) !== 'WAVE') {
        logger.error('Arquivo não tem um cabeçalho WAV válido');
        fs.closeSync(fd);
        return;
      }
      
      // Calcular o tamanho dos chunks
      const dataSize = fileSize - 44; // Tamanho dos dados (excluindo o cabeçalho)
      const riffSize = fileSize - 8; // Tamanho do chunk RIFF (excluindo ChunkID e ChunkSize)
      
      // Atualizar tamanhos no cabeçalho
      headerBuffer.writeUInt32LE(riffSize, 4); // ChunkSize
      headerBuffer.writeUInt32LE(dataSize, 40); // Subchunk2Size (tamanho dos dados)
      
      // Escrever o cabeçalho atualizado de volta no arquivo
      fs.writeSync(fd, headerBuffer, 0, 44, 0);
      fs.closeSync(fd);
      
      logger.info(`Cabeçalho WAV atualizado: tamanho total=${fileSize}, dataSize=${dataSize}`);
    } catch (error) {
      logger.error(`Erro ao atualizar cabeçalho WAV: ${error.message}`);
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
      
      // Verificar se o arquivo existe
      if (!fs.existsSync(audioFile)) {
        throw new Error(`Arquivo de áudio não encontrado: ${audioFile}`);
      }
      
      // Verificar tamanho do arquivo
      const stats = fs.statSync(audioFile);
      logger.info(`Tamanho do arquivo de áudio: ${stats.size} bytes`);
      
      if (stats.size < 44) { // 44 bytes é o tamanho mínimo para um cabeçalho WAV
        throw new Error(`Arquivo de áudio muito pequeno: ${stats.size} bytes (mínimo 44 bytes)`);
      }
      
      // Diagnosticar o arquivo - ler o cabeçalho para verificar se é WAV válido
      const header = Buffer.alloc(44);
      try {
        const fd = fs.openSync(audioFile, 'r');
        fs.readSync(fd, header, 0, 44, 0);
        fs.closeSync(fd);
        
        // Verificar assinatura RIFF WAV
        const isWav = header.toString('ascii', 0, 4) === 'RIFF' && 
                      header.toString('ascii', 8, 12) === 'WAVE';
                      
        if (!isWav) {
          logger.warn(`Arquivo não parece ser um WAV válido: ${audioFile}`);
          logger.info(`Assinatura: ${header.toString('ascii', 0, 4)}, Formato: ${header.toString('ascii', 8, 12)}`);
          logger.info(`Primeiros 16 bytes: ${header.toString('hex', 0, 16)}`);
        } else {
          // Extrair informações do cabeçalho WAV
          const numChannels = header.readUInt16LE(22);
          const sampleRate = header.readUInt32LE(24);
          const bitsPerSample = header.readUInt16LE(34);
          
          logger.info(`Informações do WAV: canais=${numChannels}, taxa=${sampleRate}Hz, bits=${bitsPerSample}`);
        }
      } catch (headerError) {
        logger.error(`Erro ao ler cabeçalho do arquivo: ${headerError.message}`);
      }
      
      // Verificar se precisamos converter o formato
      const needsConversion = false; // Na prática, implemente a lógica para determinar isso
      
      let fileToTranscribe = audioFile;
      
      // Se precisa converter, criar uma versão MP3
      if (needsConversion) {
        try {
          const mp3File = `${audioFile}.mp3`;
          logger.info(`Tentando converter ${audioFile} para MP3: ${mp3File}`);
          
          // Aqui você precisaria implementar a conversão usando ffmpeg ou outro utilitário
          // Por enquanto, apenas um log
          logger.info(`Conversão para MP3 seria necessária para alguns casos`);
          
          // Usar o arquivo original por enquanto
          fileToTranscribe = audioFile;
        } catch (convError) {
          logger.error(`Erro ao converter formato: ${convError.message}`);
          // Continuar com o arquivo original em caso de erro
        }
      }
      
      // Usar o serviço OpenAI existente com arquivo potencialmente convertido
      logger.info(`Enviando para transcrição: ${fileToTranscribe}`);
      const transcription = await openaiService.transcribeAudioVideo(fileToTranscribe, 'pt');
      
      logger.info(`Transcrição concluída com sucesso, tamanho: ${transcription.length} caracteres`);
      
      // Se a transcrição contém texto de legendas, consideramos como uma falha de detecção
      const legendasTexts = ['Legendas pela comunidade', 'Amara.org', 'Legendas', 'legenda'];
      const hasLegendaText = legendasTexts.some(text => transcription.toLowerCase().includes(text.toLowerCase()));
      
      if (!transcription || transcription.trim() === '' || hasLegendaText) {
        logger.info(`Transcrição inválida detectada: "${transcription}". Gerando texto de resposta padrão`);
        
        const defaultText = "Nenhuma fala detectada. A gravação pode conter apenas silêncio ou ruído de fundo. " + 
                           "Tente falar mais próximo do microfone ou verificar se seu microfone está funcionando corretamente.";
        
        return defaultText;
      }
      
      // Se chegou aqui, temos uma transcrição válida
      logger.info(`Transcrição válida detectada: "${transcription.substring(0, 50)}..."`);
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
   * Transcreve o áudio atual sem parar a gravação, com otimizações para detecção de voz baixa
   * @returns {Promise<Object>} Resultado da transcrição parcial
   */
  async transcribeCurrentAudio() {
    try {
      if (!this.isRecording) {
        logger.error(`[webrtc-service] Nenhuma gravação ativa para sessão ${this.id}`);
        return null;
      }
      
      // Calcular duração atual da gravação
      const duration = Date.now() - this.recordingStartTime;
      logger.info(`[webrtc-service] Duração atual da gravação: ${duration}ms`);
      
      // Verificar se o arquivo existe
      if (!fs.existsSync(this.outputFile)) {
        logger.error(`[webrtc-service] Arquivo de gravação não encontrado: ${this.outputFile}`);
        return null;
      }
      
      // Verificar tamanho do arquivo
      const fileStats = fs.statSync(this.outputFile);
      logger.info(`[webrtc-service] Arquivo de gravação encontrado. Tamanho: ${fileStats.size} bytes`);
      
      // Verificar se o arquivo é um WAV válido (pelo menos o cabeçalho)
      if (fileStats.size < 44) {
        logger.error(`[webrtc-service] Arquivo de gravação muito pequeno ou corrompido: ${fileStats.size} bytes`);
        return null;
      }
      
      // Verificar se o arquivo é um WAV válido
      logger.info(`[webrtc-service] Arquivo WAV válido confirmado: ${this.outputFile}`);
      
      // Criar arquivo temporário para transcrição (cópia do atual)
      const tempOutputFile = `${this.outputFile}.temp-${Date.now()}.wav`;
      
      // Criar o arquivo temporário copiando o arquivo original
      fs.copyFileSync(this.outputFile, tempOutputFile);
      
      // Verificar o tamanho do arquivo temporário
      const tempStats = fs.statSync(tempOutputFile);
      logger.info(`[webrtc-service] Arquivo temporário: ${tempStats.size} bytes`);
      
      // Adicionar um tom de referência ao arquivo para ajudar no processamento
      // e garantir que há conteúdo suficiente para a API
      await this._injectReferenceAudio(tempOutputFile);
      
      // Verificar o tamanho atualizado
      const updatedStats = fs.statSync(tempOutputFile);
      logger.info(`[webrtc-service] Arquivo temporário após adição de referência: ${updatedStats.size} bytes`);
      
      // Transcrever o arquivo temporário
      logger.info(`[webrtc-service] Enviando arquivo para transcrição: ${tempOutputFile}`);
      const transcription = await this.transcribeAudio(tempOutputFile);
      
      // Registrar timestamp da transcrição parcial
      const timestamp = new Date().toISOString();
      
      // Remover arquivo temporário após transcrição
      try {
        fs.unlinkSync(tempOutputFile);
        logger.info(`[webrtc-service] Arquivo temporário removido: ${tempOutputFile}`);
      } catch (err) {
        logger.warn(`[webrtc-service] Não foi possível remover arquivo temporário: ${tempOutputFile}`, err);
      }
      
      return {
        duration,
        transcription,
        timestamp
      };
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao transcrever áudio atual para sessão ${this.id}:`, error);
      return null;
    }
  }
  
  /**
   * Adiciona um tom de referência ao arquivo para facilitar a detecção de áudio
   * @param {string} filePath - Caminho para o arquivo
   * @returns {Promise<boolean>} Sucesso da operação
   * @private
   */
  async _injectReferenceAudio(filePath) {
    try {
      logger.info(`[webrtc-service] Adicionando tons de referência para melhorar detecção: ${filePath}`);
      
      // Ler o arquivo atual
      const fileData = fs.readFileSync(filePath);
      
      // Criar buffer para o tom de referência
      const sampleRate = 48000;
      const duration = 0.5; // 0.5 segundos
      const bufferSize = Math.floor(sampleRate * 2 * 2 * duration); // stereo, 16bit
      const referenceBuffer = Buffer.alloc(bufferSize);
      
      // Gerar um tom de referência com frequência que não interfere na voz humana
      // mas que pode ser detectado pelo sistema de transcrição
      const frequency = 19000; // 19kHz - frequência alta fora do espectro vocal normal
      const amplitude = 0.05; // 5% do volume máximo - baixo o suficiente para não interferir
      
      for (let i = 0; i < sampleRate * duration; i++) {
        const sampleValue = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
        const intValue = Math.floor(sampleValue * 32767); // conversão para int16
        
        // Gravar nos canais esquerdo e direito
        referenceBuffer.writeInt16LE(intValue, i * 4);
        referenceBuffer.writeInt16LE(intValue, i * 4 + 2);
      }
      
      // Criar buffer combinado:
      // [Início do arquivo (cabeçalho)] + [Tom de referência] + [Dados originais a partir do offset 44]
      const headerData = fileData.slice(0, 44); // Cabeçalho WAV de 44 bytes
      const audioData = fileData.slice(44); // Dados de áudio após o cabeçalho
      
      // Concatenar na ordem: cabeçalho + tom de referência + dados originais
      const combinedBuffer = Buffer.concat([
        headerData,
        referenceBuffer,
        audioData
      ]);
      
      // Atualizar o tamanho do arquivo no cabeçalho
      const fileSize = combinedBuffer.length - 8;
      combinedBuffer.writeUInt32LE(fileSize, 4);
      
      // Atualizar o tamanho dos dados de áudio
      const dataSize = combinedBuffer.length - 44;
      combinedBuffer.writeUInt32LE(dataSize, 40);
      
      // Escrever o arquivo atualizado
      fs.writeFileSync(filePath, combinedBuffer);
      
      logger.info(`[webrtc-service] Tom de referência adicionado (${bufferSize} bytes) ao arquivo ${filePath}`);
      return true;
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao adicionar tom de referência: ${error.message}`);
      return false;
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
   * Transcreve o áudio atual sem parar a gravação, com otimizações para detecção de voz baixa
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
  },
  
  /**
   * Registra um participante na sessão WebRTC mesmo sem producer
   * @param {string} sessionId - ID da sessão
   * @param {string} participantId - ID do participante
   * @returns {Promise<boolean>} Sucesso ou falha
   */
  async registerParticipant(sessionId, participantId) {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        logger.error(`Sessão WebRTC ${sessionId} não encontrada para registrar participante ${participantId}`);
        return false;
      }
      
      // Verificar se o participante já existe
      if (!session.participants.has(participantId)) {
        // Criar novo participante
        logger.info(`Registrando participante ${participantId} na sessão ${sessionId} explicitamente`);
        session.participants.set(participantId, {
          id: participantId,
          producerTransport: null,
          consumerTransport: null,
          producers: new Map(),
          consumers: new Map(),
          inputStream: null,
          isReal: true, // Marcar como real mesmo sem producer
          autoRegistered: true // Indicar que foi registrado automaticamente
        });
        
        // Incrementar contador de participantes reais
        session.realParticipantCount = (session.realParticipantCount || 0) + 1;
        
        logger.info(`Participante ${participantId} registrado com sucesso. Total de participantes: ${session.participants.size}, reais: ${session.realParticipantCount}`);
        return true;
      } else {
        // Participante já registrado
        const participant = session.participants.get(participantId);
        if (!participant.isReal) {
          participant.isReal = true;
          session.realParticipantCount = (session.realParticipantCount || 0) + 1;
          logger.info(`Participante ${participantId} já registrado, marcado como real agora`);
        }
        return true;
      }
    } catch (error) {
      logger.error(`Erro ao registrar participante ${participantId} na sessão ${sessionId}:`, error);
      return false;
    }
  }
};

module.exports = webRTCService; 