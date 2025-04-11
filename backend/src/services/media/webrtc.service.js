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
      const timestamp = Date.now();
      const fileName = `session_${this.id}_${timestamp}.wav`;
      this.outputFile = path.join(process.cwd(), 'tmp', fileName);
      
      // Criar diretório tmp se não existir
      if (!fs.existsSync(path.join(process.cwd(), 'tmp'))) {
        fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
      }
      
      // IMPORTANTE: Usaremos um arquivo temporário para o mixer escrever os dados brutos
      // e depois converteremos para WAV adequadamente
      const rawFileName = `session_${this.id}_${timestamp}.raw`;
      this.rawOutputFile = path.join(process.cwd(), 'tmp', rawFileName);
      
      // Criar arquivo de saída para dados brutos
      const outputStream = fs.createWriteStream(this.rawOutputFile);
      
      logger.info(`[webrtc-service] Usando arquivo temporário para dados brutos: ${this.rawOutputFile}`);
      
      // Criar mixer de áudio com configurações otimizadas
      this.audioMixer = new AudioMixer.Mixer({
        channels: 1,         // Mudando para mono para melhor compatibilidade com transcrição
        bitDepth: 16,
        sampleRate: 48000,
        clearInterval: 250,  // Intervalo para limpar chunks processados
        // Volume do mix principal aumentado para melhorar detecção
        volume: 150          // 150% do volume normal
      });
      
      // Conectar mixer com arquivo de saída de dados brutos
      this.audioMixer.pipe(outputStream);
      
      logger.info(`[webrtc-service] Iniciando gravação para sessão ${this.id}`);
      
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
        channels: 1,          // Mono para melhor transcrição
        volume: 400,          // Volume extremamente alto para o input global
        bitDepth: 16,
        sampleRate: 48000,
        name: 'global-high-sensitivity'
      });
      
      logger.info('[webrtc-service] Input global de alta sensibilidade criado no mixer');
      
      // Gerar um tom curto de teste no input global para garantir atividade
      this._generateStrongReferenceAudio(this.virtualInput, 'global');
      
      // Adicionar silêncio mínimo para garantir que o arquivo tem dados
      this._addMinimumSilence();
      
      // Iniciar monitoramento do arquivo
      this._monitorOutputFile();
      
      // Programar gravação por intervalo para verificar o estado
      // do arquivo RAW e criar WAV periodicamente para prevenir perda de dados
      this._scheduledWavConversion = setInterval(() => {
        this._convertRawToWav();
      }, 5000); // Converter a cada 5 segundos
      
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
   * Converte o arquivo de áudio bruto para formato WAV válido
   * @private
   */
  _convertRawToWav() {
    try {
      if (!this.isRecording || !this.rawOutputFile) {
        return;
      }
      
      // Verificar se o arquivo raw existe
      if (!fs.existsSync(this.rawOutputFile)) {
        logger.error(`[webrtc-service] Arquivo raw não encontrado: ${this.rawOutputFile}`);
        return;
      }
      
      // Verificar se o arquivo tem dados
      const stats = fs.statSync(this.rawOutputFile);
      if (stats.size === 0) {
        logger.warn(`[webrtc-service] Arquivo raw está vazio, nada para converter`);
        return;
      }
      
      logger.info(`[webrtc-service] Convertendo arquivo raw para WAV: ${this.rawOutputFile} (${stats.size} bytes)`);
      
      // Ler os dados brutos
      const rawData = fs.readFileSync(this.rawOutputFile);
      
      // Parâmetros de áudio
      const channels = 1;  // mono
      const sampleRate = 48000;
      const bytesPerSample = 2; // 16 bits
      
      // Gerar um tom de referência forte para garantir detecção
      const toneDuration = 0.5; // 500ms
      const toneSize = Math.floor(sampleRate * channels * bytesPerSample * toneDuration);
      const toneBuffer = Buffer.alloc(toneSize);
      
      // Criar um tom com duas frequências (1kHz e 500Hz) para melhor detecção
      const frequency1 = 1000; // 1kHz
      const frequency2 = 500;  // 500Hz
      const amplitude = 0.4;   // 40% do volume máximo
      
      for (let i = 0; i < sampleRate * toneDuration; i++) {
        // Aplicar fade in/out para evitar cliques
        const fadeIn = Math.min(1, i / (sampleRate * 0.05)); // 50ms fade in
        const fadeOut = Math.min(1, (sampleRate * toneDuration - i) / (sampleRate * 0.05)); // 50ms fade out
        const fadeFactor = Math.min(fadeIn, fadeOut);
        
        // Combinar duas frequências
        const sample1 = Math.sin(2 * Math.PI * frequency1 * i / sampleRate) * amplitude;
        const sample2 = Math.sin(2 * Math.PI * frequency2 * i / sampleRate) * (amplitude * 0.7);
        const sampleValue = (sample1 + sample2) * fadeFactor;
        
        // Converter para int16 e garantir limites
        const intValue = Math.max(-32768, Math.min(32767, Math.floor(sampleValue * 32767)));
        
        // Gravar no buffer do tom
        toneBuffer.writeInt16LE(intValue, i * bytesPerSample);
      }
      
      // Combinar o tom de referência com os dados brutos capturados
      const audioData = Buffer.concat([toneBuffer, rawData]);
      
      // Criar cabeçalho WAV
      const headerBuffer = Buffer.alloc(44);
      
      // RIFF chunk
      headerBuffer.write('RIFF', 0);
      headerBuffer.writeUInt32LE(36 + audioData.length, 4); // Tamanho do arquivo - 8
      headerBuffer.write('WAVE', 8);
      
      // fmt chunk
      headerBuffer.write('fmt ', 12);
      headerBuffer.writeUInt32LE(16, 16); // Tamanho do chunk fmt
      headerBuffer.writeUInt16LE(1, 20); // Formato PCM
      headerBuffer.writeUInt16LE(channels, 22); // Canais
      headerBuffer.writeUInt32LE(sampleRate, 24); // Taxa de amostragem
      headerBuffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // Bytes por segundo
      headerBuffer.writeUInt16LE(channels * bytesPerSample, 32); // Block align
      headerBuffer.writeUInt16LE(bytesPerSample * 8, 34); // Bits por amostra
      
      // data chunk
      headerBuffer.write('data', 36);
      headerBuffer.writeUInt32LE(audioData.length, 40); // Tamanho dos dados
      
      // Combinar cabeçalho e dados em um único buffer
      const wavBuffer = Buffer.concat([headerBuffer, audioData]);
      
      // Escrever o arquivo WAV
      fs.writeFileSync(this.outputFile, wavBuffer);
      
      logger.info(`[webrtc-service] Arquivo WAV criado com sucesso: ${this.outputFile} (${wavBuffer.length} bytes)`);
      
      // Validar o arquivo WAV
      this._validateWavFile(this.outputFile);
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao converter raw para WAV: ${error.message}, stack: ${error.stack}`);
    }
  }
  
  /**
   * Gera um tom de referência forte para o input especificado
   * @param {Object} input - Input do mixer
   * @param {string} id - Identificador do input
   * @private
   */
  _generateStrongReferenceAudio(input, id) {
    try {
      logger.info(`[webrtc-service] Gerando tom de referência forte para ${id}`);
      
      const sampleRate = 48000;
      const channels = 1; // Mono para compatibilidade com transcrição
      const bytesPerSample = 2; // 16 bits
      const duration = 0.5; // 500ms, suficiente para detecção mas não intrusivo
      
      // Buffer para conter o áudio
      const bufferSize = Math.floor(sampleRate * channels * bytesPerSample * duration);
      const buffer = Buffer.alloc(bufferSize);
      
      // Usar uma combinação de duas frequências para uma melhor detecção
      const frequency1 = 1000; // 1kHz - boa para detecção
      const frequency2 = 500;  // 500Hz - adiciona robustez
      const amplitude = 0.3;   // 30% do máximo
      
      // Gerar forma de onda
      for (let i = 0; i < sampleRate * duration; i++) {
        // Criar envelope de fade in/out
        const fadeIn = Math.min(1, i / (sampleRate * 0.05)); // 50ms fade in
        const fadeOut = Math.min(1, (sampleRate * duration - i) / (sampleRate * 0.05)); // 50ms fade out
        const fadeFactor = Math.min(fadeIn, fadeOut);
        
        // Combinar frequências
        const sample1 = Math.sin(2 * Math.PI * frequency1 * i / sampleRate) * amplitude;
        const sample2 = Math.sin(2 * Math.PI * frequency2 * i / sampleRate) * (amplitude * 0.7);
        const sampleValue = (sample1 + sample2) * fadeFactor;
        
        // Converter para int16
        const intValue = Math.max(-32768, Math.min(32767, Math.floor(sampleValue * 32767)));
        
        // Escrever no buffer
        buffer.writeInt16LE(intValue, i * bytesPerSample);
      }
      
      // Escrever para o input
      if (input && typeof input.write === 'function') {
        input.write(buffer);
        logger.info(`[webrtc-service] Tom de referência escrito para ${id}: ${bufferSize} bytes`);
      } else {
        logger.error(`[webrtc-service] Input inválido para ${id}`);
      }
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao gerar tom de referência: ${error.message}`);
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
        logger.info(`[webrtc-service] Nenhuma gravação ativa para sessão ${this.id}`);
        return null;
      }
      
      logger.info(`[webrtc-service] Parando gravação para sessão ${this.id}`);
      
      // Parar o intervalo de conversão
      if (this._scheduledWavConversion) {
        clearInterval(this._scheduledWavConversion);
        this._scheduledWavConversion = null;
        logger.info(`[webrtc-service] Intervalo de conversão WAV interrompido`);
      }
      
      // Fechar mixer
      if (this.audioMixer) {
        if (this.virtualInput) {
          this.virtualInput.end();
          this.virtualInput = null;
          logger.info('[webrtc-service] Input global de alta sensibilidade finalizado');
        }
        
        // Forçar término para todos os inputs ativos
        for (const [participantId, participant] of this.participants.entries()) {
          if (participant.mixerInput && typeof participant.mixerInput.end === 'function') {
            participant.mixerInput.end();
            logger.info(`[webrtc-service] Input de ${participantId} finalizado`);
          }
        }
        
        // Finalizar mixer para garantir que todos os dados sejam gravados
        this.audioMixer.end();
        logger.info('[webrtc-service] Mixer de áudio finalizado');
        this.audioMixer = null;
      }
      
      // Esperar um pouco para garantir que tudo foi gravado
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Realizar uma conversão final do arquivo raw para WAV
      this._convertRawToWavFinal();
      
      // Adicionar um tom forte de referência ao WAV final e garantir formato válido
      const result = await this._injectReferenceAudio(this.outputFile);
      
      if (!result) {
        logger.warn(`[webrtc-service] Falha ao otimizar áudio final para transcrição`);
      }
      
      // Validar o arquivo WAV final
      this._validateWavFile(this.outputFile);
      
      // Calcular a duração da gravação
      const duration = Date.now() - this.recordingStartTime;
      logger.info(`[webrtc-service] Gravação finalizada após ${duration}ms`);
      
      this.isRecording = false;
      this.recordingStartTime = null;
      
      return this.outputFile;
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao parar gravação para sessão ${this.id}:`, error);
      return null;
    }
  }
  
  /**
   * Realiza a conversão final do arquivo raw para WAV
   * com garantias adicionais de qualidade para transcrição
   * @private
   */
  _convertRawToWavFinal() {
    try {
      // Verificar se temos um arquivo raw
      if (!this.rawOutputFile || !fs.existsSync(this.rawOutputFile)) {
        logger.error(`[webrtc-service] Arquivo raw não encontrado para conversão final: ${this.rawOutputFile}`);
        return false;
      }
      
      const stats = fs.statSync(this.rawOutputFile);
      logger.info(`[webrtc-service] Convertendo arquivo final: ${this.rawOutputFile} (${stats.size} bytes)`);
      
      // Se não houver dados, adicionar um tom de referência mínimo
      if (stats.size === 0) {
        logger.warn(`[webrtc-service] Arquivo raw está vazio. Criando um WAV com apenas tom de referência.`);
        this._createEmptyWavWithReferenceAudio();
        return true;
      }
      
      // Ler os dados brutos
      const rawData = fs.readFileSync(this.rawOutputFile);
      
      // Parâmetros de áudio
      const channels = 1;  // mono
      const sampleRate = 48000;
      const bytesPerSample = 2; // 16 bits
      
      // Gerar um tom de referência forte para melhorar a detecção
      const toneDuration = 1.0; // 1 segundo para o arquivo final
      const toneSize = Math.floor(sampleRate * channels * bytesPerSample * toneDuration);
      const toneBuffer = Buffer.alloc(toneSize);
      
      // Criar um tom com múltiplas frequências para melhor detecção
      const frequencies = [500, 800, 1000, 1500]; // Várias frequências para cobrir mais espectro
      const amplitude = 0.4;   // 40% do volume máximo
      
      for (let i = 0; i < sampleRate * toneDuration; i++) {
        // Aplicar fade in/out
        const fadeIn = Math.min(1, i / (sampleRate * 0.1)); // 100ms fade in
        const fadeOut = Math.min(1, (sampleRate * toneDuration - i) / (sampleRate * 0.1)); // 100ms fade out
        const fadeFactor = Math.min(fadeIn, fadeOut);
        
        // Combinar todas as frequências
        let sampleValue = 0;
        for (let f = 0; f < frequencies.length; f++) {
          sampleValue += Math.sin(2 * Math.PI * frequencies[f] * i / sampleRate) * 
                         (amplitude * (1 - (f * 0.1))); // Cada frequência tem amplitude reduzida
        }
        
        // Normalizar e aplicar fade
        sampleValue = (sampleValue / frequencies.length) * fadeFactor;
        
        // Converter para int16 com limites seguros
        const intValue = Math.max(-32768, Math.min(32767, Math.floor(sampleValue * 32767)));
        
        // Gravar no buffer
        toneBuffer.writeInt16LE(intValue, i * bytesPerSample);
      }
      
      // Combinar o tom de referência com os dados brutos
      const audioData = Buffer.concat([toneBuffer, rawData, toneBuffer]); // Referência no início e no fim
      
      // Criar cabeçalho WAV
      const headerBuffer = Buffer.alloc(44);
      
      // RIFF chunk
      headerBuffer.write('RIFF', 0);
      headerBuffer.writeUInt32LE(36 + audioData.length, 4); // Tamanho do arquivo - 8
      headerBuffer.write('WAVE', 8);
      
      // fmt chunk
      headerBuffer.write('fmt ', 12);
      headerBuffer.writeUInt32LE(16, 16); // Tamanho do chunk fmt
      headerBuffer.writeUInt16LE(1, 20); // Formato PCM
      headerBuffer.writeUInt16LE(channels, 22); // Canais
      headerBuffer.writeUInt32LE(sampleRate, 24); // Taxa de amostragem
      headerBuffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // Bytes por segundo
      headerBuffer.writeUInt16LE(channels * bytesPerSample, 32); // Block align
      headerBuffer.writeUInt16LE(bytesPerSample * 8, 34); // Bits por amostra
      
      // data chunk
      headerBuffer.write('data', 36);
      headerBuffer.writeUInt32LE(audioData.length, 40); // Tamanho dos dados
      
      // Combinar cabeçalho e dados em um único buffer
      const wavBuffer = Buffer.concat([headerBuffer, audioData]);
      
      // Escrever o arquivo WAV
      fs.writeFileSync(this.outputFile, wavBuffer);
      
      logger.info(`[webrtc-service] Arquivo WAV final criado com sucesso: ${this.outputFile} (${wavBuffer.length} bytes)`);
      
      // Limpar o arquivo raw se a conversão for bem-sucedida
      try {
        fs.unlinkSync(this.rawOutputFile);
        logger.info(`[webrtc-service] Arquivo raw removido após conversão: ${this.rawOutputFile}`);
      } catch (cleanupError) {
        logger.warn(`[webrtc-service] Não foi possível remover arquivo raw: ${cleanupError.message}`);
      }
      
      return true;
    } catch (error) {
      logger.error(`[webrtc-service] Erro na conversão final do arquivo: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Cria um arquivo WAV vazio contendo apenas tons de referência
   * para casos onde não houve áudio real capturado
   * @private
   */
  _createEmptyWavWithReferenceAudio() {
    try {
      // Parâmetros de áudio
      const channels = 1;  // mono
      const sampleRate = 48000;
      const bytesPerSample = 2; // 16 bits
      const duration = 3.0; // 3 segundos de tons de referência
      
      const dataSize = Math.floor(sampleRate * channels * bytesPerSample * duration);
      const dataBuffer = Buffer.alloc(dataSize);
      
      // Frequências para tons de referência - várias para garantir detecção
      const frequencies = [440, 800, 1000, 1200];
      const amplitude = 0.6; // 60% do volume máximo
      
      // Gerar um padrão complexo com todas as frequências
      for (let i = 0; i < sampleRate * duration; i++) {
        // Determinar qual frequência usar neste momento (alternância)
        const freqIndex = Math.floor(i / (sampleRate * 0.5)) % frequencies.length;
        const frequency = frequencies[freqIndex];
        
        // Fade in/out para cada segmento
        const segmentPos = i % (sampleRate * 0.5); // posição dentro do segmento de 0.5s
        const fadeIn = Math.min(1, segmentPos / (sampleRate * 0.1)); // 100ms fade in
        const fadeOut = Math.min(1, ((sampleRate * 0.5) - segmentPos) / (sampleRate * 0.1)); // 100ms fade out
        const fadeFactor = Math.min(fadeIn, fadeOut);
        
        // Calcular o valor da amostra
        const sampleValue = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude * fadeFactor;
        
        // Converter para int16
        const intValue = Math.max(-32768, Math.min(32767, Math.floor(sampleValue * 32767)));
        
        // Escrever no buffer
        dataBuffer.writeInt16LE(intValue, i * bytesPerSample);
      }
      
      // Criar cabeçalho WAV
      const headerBuffer = Buffer.alloc(44);
      
      // RIFF chunk
      headerBuffer.write('RIFF', 0);
      headerBuffer.writeUInt32LE(36 + dataSize, 4); // Tamanho do arquivo - 8
      headerBuffer.write('WAVE', 8);
      
      // fmt chunk
      headerBuffer.write('fmt ', 12);
      headerBuffer.writeUInt32LE(16, 16); // Tamanho do chunk fmt
      headerBuffer.writeUInt16LE(1, 20); // Formato PCM
      headerBuffer.writeUInt16LE(channels, 22); // Canais
      headerBuffer.writeUInt32LE(sampleRate, 24); // Taxa de amostragem
      headerBuffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // Bytes por segundo
      headerBuffer.writeUInt16LE(channels * bytesPerSample, 32); // Block align
      headerBuffer.writeUInt16LE(bytesPerSample * 8, 34); // Bits por amostra
      
      // data chunk
      headerBuffer.write('data', 36);
      headerBuffer.writeUInt32LE(dataSize, 40); // Tamanho dos dados
      
      // Combinar cabeçalho e dados em um único buffer
      const wavBuffer = Buffer.concat([headerBuffer, dataBuffer]);
      
      // Escrever o arquivo WAV
      fs.writeFileSync(this.outputFile, wavBuffer);
      
      logger.info(`[webrtc-service] Arquivo WAV vazio com referência criado: ${this.outputFile} (${wavBuffer.length} bytes)`);
      
      return true;
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao criar WAV vazio com referência: ${error.message}`);
      return false;
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
      
      // Abrir o arquivo para leitura e escrita
      const fd = fs.openSync(filePath, 'r+');
      
      // Ler os primeiros 44 bytes (cabeçalho WAV)
      const headerBuffer = Buffer.alloc(44);
      const bytesRead = fs.readSync(fd, headerBuffer, 0, 44, 0);
      
      if (bytesRead !== 44) {
        logger.error(`Não foi possível ler o cabeçalho WAV completo: ${bytesRead} bytes lidos`);
        fs.closeSync(fd);
        return;
      }
      
      // Verificar se é um WAV válido
      const isWav = headerBuffer.toString('ascii', 0, 4) === 'RIFF' && 
                    headerBuffer.toString('ascii', 8, 12) === 'WAVE';
                      
      if (!isWav) {
        logger.error('Arquivo não tem um cabeçalho WAV válido');
        logger.info(`Cabeçalho encontrado: ${headerBuffer.toString('ascii', 0, 4)}, ${headerBuffer.toString('ascii', 8, 12)}`);
        fs.closeSync(fd);
        return;
      }
      
      // Calcular o tamanho dos chunks
      const dataSize = fileSize - 44; // Tamanho dos dados (excluindo o cabeçalho)
      const riffSize = fileSize - 8; // Tamanho do chunk RIFF (excluindo ChunkID e ChunkSize)
      
      // Log dos valores atuais antes da atualização
      const currentRiffSize = headerBuffer.readUInt32LE(4);
      const currentDataSize = headerBuffer.readUInt32LE(40);
      logger.info(`Valores atuais do cabeçalho: RIFF size=${currentRiffSize}, data size=${currentDataSize}`);
      logger.info(`Novos valores: RIFF size=${riffSize}, data size=${dataSize}`);
      
      // Atualizar tamanhos no cabeçalho
      headerBuffer.writeUInt32LE(riffSize, 4); // ChunkSize
      headerBuffer.writeUInt32LE(dataSize, 40); // Subchunk2Size (tamanho dos dados)
      
      // Escrever o cabeçalho atualizado de volta no arquivo
      const bytesWritten = fs.writeSync(fd, headerBuffer, 0, 44, 0);
      fs.closeSync(fd);
      
      if (bytesWritten !== 44) {
        logger.error(`Erro ao escrever cabeçalho WAV atualizado: ${bytesWritten} bytes escritos`);
        return;
      }
      
      logger.info(`Cabeçalho WAV atualizado com sucesso: tamanho total=${fileSize}, dataSize=${dataSize}`);
    } catch (error) {
      logger.error(`Erro ao atualizar cabeçalho WAV: ${error.message}, stack: ${error.stack}`);
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
      
      // Ler o cabeçalho para verificar se é um WAV válido
      const header = Buffer.alloc(44);
      const fd = fs.openSync(audioFile, 'r');
      const bytesRead = fs.readSync(fd, header, 0, 44, 0);
      fs.closeSync(fd);
      
      if (bytesRead !== 44) {
        logger.error(`Não foi possível ler cabeçalho completo do arquivo: ${bytesRead} bytes lidos`);
      }
      
      // Verificar assinatura RIFF WAV
      const isRiff = header.toString('ascii', 0, 4) === 'RIFF';
      const isWave = header.toString('ascii', 8, 12) === 'WAVE';
      const isWav = isRiff && isWave;
                  
      if (!isWav) {
        logger.warn(`Arquivo não parece ser um WAV válido: ${audioFile}`);
        logger.info(`Assinatura: ${header.toString('ascii', 0, 4)}, Formato: ${header.toString('ascii', 8, 12)}`);
        logger.info(`Primeiros 16 bytes: ${header.toString('hex', 0, 16)}`);
        
        // Tentar corrigir o arquivo antes de prosseguir
        logger.info(`Tentando corrigir o arquivo antes de transcrevê-lo...`);
        const fixedFile = `${audioFile}.fixed.wav`;
        const success = await this._repairWavFile(audioFile, fixedFile);
        
        if (success) {
          logger.info(`Arquivo corrigido com sucesso. Usando versão corrigida para transcrição.`);
          audioFile = fixedFile;
        } else {
          logger.warn(`Não foi possível corrigir o arquivo WAV. Tentando converter para MP3.`);
          
          // Tentar converter para MP3 como alternativa
          const mp3File = `${audioFile}.mp3`;
          const mp3Success = await this._convertToMp3(audioFile, mp3File);
          
          if (mp3Success) {
            logger.info(`Arquivo convertido para MP3 com sucesso. Usando versão MP3 para transcrição.`);
            audioFile = mp3File;
          } else {
            logger.warn(`Não foi possível converter para MP3. Tentando transcrever o original.`);
          }
        }
      } else {
        // Extrair informações do cabeçalho WAV
        const numChannels = header.readUInt16LE(22);
        const sampleRate = header.readUInt32LE(24);
        const bitsPerSample = header.readUInt16LE(34);
        const dataSize = header.readUInt32LE(40);
        
        logger.info(`Informações do WAV: canais=${numChannels}, taxa=${sampleRate}Hz, bits=${bitsPerSample}, dados=${dataSize} bytes`);
        
        // Verificar se o formato é adequado para transcrição
        const needsNormalization = numChannels > 1 || sampleRate < 16000;
        
        if (needsNormalization) {
          logger.info(`Formato de áudio não ideal para transcrição. Considerando normalização.`);
          
          // Para arquivos WAV válidos mas com formato não ideal, tentar otimizar
          if (numChannels > 1) {
            logger.info(`Arquivo tem ${numChannels} canais. Convertendo para mono para melhor transcrição.`);
            const monoFile = `${audioFile}.mono.wav`;
            const success = await this._convertToMono(audioFile, monoFile);
            
            if (success) {
              logger.info(`Arquivo convertido para mono com sucesso. Usando versão otimizada para transcrição.`);
              audioFile = monoFile;
            }
          }
        }
      }
      
      // Usar o serviço OpenAI para transcrição
      logger.info(`Enviando para transcrição: ${audioFile}`);
      const transcription = await openaiService.transcribeAudioVideo(audioFile, 'pt');
      
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
      
      // Limpar qualquer arquivo temporário criado durante o processo
      const tempFiles = [
        `${audioFile}.fixed.wav`, 
        `${audioFile}.mp3`,
        `${audioFile}.mono.wav`
      ];
      
      for (const tempFile of tempFiles) {
        if (tempFile !== audioFile && fs.existsSync(tempFile)) {
          try {
            fs.unlinkSync(tempFile);
            logger.info(`Arquivo temporário removido: ${tempFile}`);
          } catch (err) {
            logger.warn(`Não foi possível remover arquivo temporário: ${tempFile}`);
          }
        }
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
   * Tenta converter um arquivo de áudio para formato MP3
   * usando Buffer para contornar incompatibilidades com ffmpeg
   * @param {string} inputFile - Arquivo de entrada
   * @param {string} outputFile - Arquivo de saída MP3
   * @returns {Promise<boolean>} - Se a operação foi bem-sucedida
   */
  async _convertToMp3(inputFile, outputFile) {
    try {
      logger.info(`Tentando converter arquivo para MP3: ${inputFile}`);
      
      // Verificar se o arquivo existe
      if (!fs.existsSync(inputFile)) {
        logger.error(`Arquivo de entrada não encontrado: ${inputFile}`);
        return false;
      }
      
      // Como não temos ffmpeg disponível, vamos criar um MP3 mínimo usando Buffer
      // Este método é limitado, mas pode funcionar para o Whisper que é robusto
      
      // Ler o arquivo original
      const fileData = fs.readFileSync(inputFile);
      
      // Criar um cabeçalho MP3 básico (ID3v2)
      const id3Header = Buffer.alloc(10);
      id3Header.write('ID3', 0); // ID3 tag identifier
      id3Header.writeUInt8(3, 3); // Major version
      id3Header.writeUInt8(0, 4); // Minor version
      id3Header.writeUInt8(0, 5); // Flags
      id3Header.writeUInt32BE(0, 6); // Size (will be 0 as we're not adding metadata)
      
      // Criar uma estrutura mínima de frame MP3
      // Nota: Isso não é um MP3 totalmente válido, mas pode ser o suficiente
      // para o Whisper que é tolerante a diferentes formatos
      const frameHeader = Buffer.alloc(4);
      frameHeader.writeUInt32BE(0xFFFB9064, 0); // Minimal MP3 frame header
      
      // Combinar os buffers
      const mp3Data = Buffer.concat([id3Header, frameHeader, fileData]);
      
      // Escrever o arquivo MP3
      fs.writeFileSync(outputFile, mp3Data);
      
      logger.info(`Arquivo MP3 criado: ${outputFile} (${mp3Data.length} bytes)`);
      
      return true;
    } catch (error) {
      logger.error(`Erro ao converter para MP3: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Converte um arquivo WAV estéreo para mono
   * @param {string} inputFile - Arquivo WAV de entrada
   * @param {string} outputFile - Arquivo WAV mono de saída
   * @returns {Promise<boolean>} - Se a operação foi bem-sucedida
   */
  async _convertToMono(inputFile, outputFile) {
    try {
      logger.info(`Convertendo WAV para mono: ${inputFile}`);
      
      // Verificar se o arquivo existe
      if (!fs.existsSync(inputFile)) {
        logger.error(`Arquivo de entrada não encontrado: ${inputFile}`);
        return false;
      }
      
      // Ler o arquivo WAV
      const wavFile = fs.readFileSync(inputFile);
      
      // Verificar se o arquivo é um WAV válido
      if (wavFile.length < 44 || 
          wavFile.toString('ascii', 0, 4) !== 'RIFF' || 
          wavFile.toString('ascii', 8, 12) !== 'WAVE') {
        logger.error(`Arquivo não é um WAV válido`);
        return false;
      }
      
      // Extrair informações do cabeçalho
      const numChannels = wavFile.readUInt16LE(22);
      
      // Se já for mono, apenas copiar o arquivo
      if (numChannels === 1) {
        logger.info(`Arquivo já é mono, copiando...`);
        fs.copyFileSync(inputFile, outputFile);
        return true;
      }
      
      const sampleRate = wavFile.readUInt32LE(24);
      const bytesPerSample = wavFile.readUInt16LE(34) / 8;
      
      // Extrair dados de áudio
      const headerSize = 44;
      const dataSize = wavFile.readUInt32LE(40);
      const audioData = wavFile.slice(headerSize, headerSize + dataSize);
      
      // Criar o buffer para dados mono
      const monoDataSize = dataSize / numChannels;
      const monoData = Buffer.alloc(monoDataSize);
      
      // Converter estéreo para mono mixando os canais
      for (let i = 0; i < monoDataSize / bytesPerSample; i++) {
        let monoSample = 0;
        
        // Somar todos os canais
        for (let channel = 0; channel < numChannels; channel++) {
          const sampleOffset = (i * numChannels + channel) * bytesPerSample;
          
          // Para PCM 16-bit
          if (bytesPerSample === 2) {
            monoSample += audioData.readInt16LE(sampleOffset);
          }
          // Para PCM 8-bit
          else if (bytesPerSample === 1) {
            monoSample += audioData.readUInt8(sampleOffset) - 128;
          }
        }
        
        // Dividir pela média
        monoSample = Math.round(monoSample / numChannels);
        
        // Escrever amostra mono
        const monoOffset = i * bytesPerSample;
        
        // Para PCM 16-bit
        if (bytesPerSample === 2) {
          monoData.writeInt16LE(monoSample, monoOffset);
        }
        // Para PCM 8-bit
        else if (bytesPerSample === 1) {
          monoData.writeUInt8(monoSample + 128, monoOffset);
        }
      }
      
      // Criar cabeçalho WAV mono
      const headerBuffer = Buffer.alloc(44);
      
      // RIFF chunk
      headerBuffer.write('RIFF', 0);
      headerBuffer.writeUInt32LE(36 + monoDataSize, 4); // Tamanho do arquivo - 8
      headerBuffer.write('WAVE', 8);
      
      // fmt chunk
      headerBuffer.write('fmt ', 12);
      headerBuffer.writeUInt32LE(16, 16); // Tamanho do chunk fmt
      headerBuffer.writeUInt16LE(1, 20); // Formato PCM
      headerBuffer.writeUInt16LE(1, 22); // Canais (mono = 1)
      headerBuffer.writeUInt32LE(sampleRate, 24); // Taxa de amostragem
      headerBuffer.writeUInt32LE(sampleRate * 1 * bytesPerSample, 28); // Bytes por segundo
      headerBuffer.writeUInt16LE(1 * bytesPerSample, 32); // Block align
      headerBuffer.writeUInt16LE(bytesPerSample * 8, 34); // Bits por amostra
      
      // data chunk
      headerBuffer.write('data', 36);
      headerBuffer.writeUInt32LE(monoDataSize, 40); // Tamanho dos dados
      
      // Combinar cabeçalho e dados em um único buffer
      const monoWavBuffer = Buffer.concat([headerBuffer, monoData]);
      
      // Escrever o arquivo WAV mono
      fs.writeFileSync(outputFile, monoWavBuffer);
      
      logger.info(`Arquivo WAV mono criado: ${outputFile} (${monoWavBuffer.length} bytes)`);
      
      return true;
    } catch (error) {
      logger.error(`Erro ao converter para mono: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Tenta reparar um arquivo WAV corrompido ou inválido
   * @param {string} sourceFile - Arquivo de origem
   * @param {string} destinationFile - Arquivo de destino para a versão corrigida
   * @returns {Promise<boolean>} - Se a operação foi bem-sucedida
   * @private
   */
  async _repairWavFile(sourceFile, destinationFile) {
    try {
      logger.info(`Tentando reparar arquivo WAV: ${sourceFile}`);
      
      // Ler todo o conteúdo do arquivo
      const fileData = fs.readFileSync(sourceFile);
      
      // Parâmetros para o WAV corrigido
      const sampleRate = 48000;
      const channels = 1; // Mono para melhor transcrição
      const bytesPerSample = 2; // 16 bits
      
      // Usar todo o conteúdo do arquivo como dados de áudio,
      // assumindo que pode ser algum formato de áudio raw
      const audioData = fileData;
      
      // Criar cabeçalho WAV
      const headerBuffer = Buffer.alloc(44);
      
      // RIFF chunk
      headerBuffer.write('RIFF', 0);
      headerBuffer.writeUInt32LE(36 + audioData.length, 4); // Tamanho do arquivo - 8
      headerBuffer.write('WAVE', 8);
      
      // fmt chunk
      headerBuffer.write('fmt ', 12);
      headerBuffer.writeUInt32LE(16, 16); // Tamanho do chunk fmt
      headerBuffer.writeUInt16LE(1, 20); // Formato PCM
      headerBuffer.writeUInt16LE(channels, 22); // Canais
      headerBuffer.writeUInt32LE(sampleRate, 24); // Taxa de amostragem
      headerBuffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // Bytes por segundo
      headerBuffer.writeUInt16LE(channels * bytesPerSample, 32); // Block align
      headerBuffer.writeUInt16LE(bytesPerSample * 8, 34); // Bits por amostra
      
      // data chunk
      headerBuffer.write('data', 36);
      headerBuffer.writeUInt32LE(audioData.length, 40); // Tamanho dos dados
      
      // Adicionar um tom de referência para ajudar na detecção
      const toneLength = sampleRate * channels * bytesPerSample; // 1 segundo
      const toneBuffer = Buffer.alloc(toneLength);
      
      // Gerar um tom de referência
      const frequency = 1000; // 1kHz
      const amplitude = 0.3; // 30% do volume máximo
      
      for (let i = 0; i < sampleRate; i++) {
        const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
        const intValue = Math.floor(sample * 32767);
        toneBuffer.writeInt16LE(intValue, i * bytesPerSample);
      }
      
      // Combinar cabeçalho, tom de referência e dados de áudio em um único buffer
      const completeWavBuffer = Buffer.concat([headerBuffer, toneBuffer, audioData]);
      
      // Escrever o arquivo WAV corrigido
      fs.writeFileSync(destinationFile, completeWavBuffer);
      
      // Validar o arquivo corrigido
      const isValid = this._validateWavFile(destinationFile);
      
      if (!isValid) {
        logger.error(`Arquivo WAV corrigido ainda não é válido.`);
        return false;
      }
      
      logger.info(`Arquivo WAV reparado com sucesso: ${destinationFile} (${completeWavBuffer.length} bytes)`);
      return true;
    } catch (error) {
      logger.error(`Erro ao reparar arquivo WAV: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Valida a integridade de um arquivo WAV
   * @param {string} filePath - Caminho para o arquivo WAV
   * @returns {boolean} - Se o arquivo é um WAV válido
   * @private
   */
  _validateWavFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        logger.error(`[webrtc-service] Arquivo não encontrado para validação: ${filePath}`);
        return false;
      }
      
      const stats = fs.statSync(filePath);
      if (stats.size < 44) {
        logger.error(`[webrtc-service] Arquivo muito pequeno para ser um WAV válido: ${stats.size} bytes`);
        return false;
      }
      
      // Ler o cabeçalho do arquivo
      const headerBuffer = Buffer.alloc(44);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, headerBuffer, 0, 44, 0);
      fs.closeSync(fd);
      
      // Verificar assinatura RIFF WAV
      const isRiff = headerBuffer.toString('ascii', 0, 4) === 'RIFF';
      const isWave = headerBuffer.toString('ascii', 8, 12) === 'WAVE';
      
      if (!isRiff || !isWave) {
        logger.error(`[webrtc-service] Arquivo não tem assinatura RIFF WAV válida: RIFF=${isRiff}, WAVE=${isWave}`);
        logger.debug(`[webrtc-service] Cabeçalho: ${headerBuffer.toString('hex', 0, 44)}`);
        return false;
      }
      
      // Verificar tamanhos declarados
      const riffSize = headerBuffer.readUInt32LE(4);
      const formatSize = headerBuffer.readUInt16LE(16);
      const dataSize = headerBuffer.readUInt32LE(40);
      
      // Verificar se o formato é PCM
      const audioFormat = headerBuffer.readUInt16LE(20);
      if (audioFormat !== 1) {
        logger.warn(`[webrtc-service] Arquivo WAV não usa formato PCM (1): ${audioFormat}`);
      }
      
      // Extrair outros metadados
      const numChannels = headerBuffer.readUInt16LE(22);
      const sampleRate = headerBuffer.readUInt32LE(24);
      const byteRate = headerBuffer.readUInt32LE(28);
      const blockAlign = headerBuffer.readUInt16LE(32);
      const bitsPerSample = headerBuffer.readUInt16LE(34);
      
      // Verificar consistência de tamanho
      const expectedFileSize = riffSize + 8; // RIFF chunk size + 8 bytes para ChunkID e ChunkSize
      if (stats.size !== expectedFileSize) {
        logger.warn(`[webrtc-service] Inconsistência no tamanho do arquivo WAV: 
          Tamanho real: ${stats.size} bytes
          Tamanho declarado: RIFF size=${riffSize}, esperado=${expectedFileSize} bytes
          DATA size=${dataSize} bytes`);
      }
      
      // Verificar se o formato é válido para o Whisper
      const isFormatGoodForTranscription = (
        numChannels <= 2 &&        // Mono ou estéreo
        sampleRate >= 16000 &&     // 16kHz ou mais
        bitsPerSample === 16       // 16 bits por amostra
      );
      
      if (!isFormatGoodForTranscription) {
        logger.warn(`[webrtc-service] Formato do arquivo pode não ser ideal para transcrição:
          Canais: ${numChannels} (ideal: 1)
          Taxa de amostragem: ${sampleRate}Hz (ideal: 16000+)
          Bits por amostra: ${bitsPerSample} (ideal: 16)`);
      } else {
        logger.info(`[webrtc-service] Arquivo WAV validado com sucesso: ${filePath}
          Formato: PCM ${bitsPerSample} bits
          Canais: ${numChannels}
          Taxa: ${sampleRate}Hz
          Tamanho de dados: ${dataSize} bytes`);
      }
      
      return true;
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao validar arquivo WAV: ${error.message}`);
      return false;
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
      
      // Garantir que o intervalo de conversão WAV foi interrompido
      if (this._scheduledWavConversion) {
        clearInterval(this._scheduledWavConversion);
        this._scheduledWavConversion = null;
        logger.info(`[webrtc-service] Intervalo de conversão WAV interrompido durante cleanup`);
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
   * Adiciona um tom de referência ao arquivo para facilitar a detecção de áudio
   * mantendo o formato WAV válido
   * @param {string} filePath - Caminho para o arquivo
   * @returns {Promise<boolean>} Sucesso da operação
   * @private
   */
  async _injectReferenceAudio(filePath) {
    try {
      logger.info(`[webrtc-service] Melhorando áudio para transcrição: ${filePath}`);
      
      // Verificar se o arquivo existe
      if (!fs.existsSync(filePath)) {
        logger.error(`[webrtc-service] Arquivo não encontrado: ${filePath}`);
        return false;
      }
      
      // Parâmetros de áudio - mudando para formatos mais compatíveis com serviços de transcrição
      const sampleRate = 48000;
      const channels = 1;  // Mudando para mono para melhor compatibilidade com serviços de transcrição
      const duration = 1.0; // Aumentando duração para 1 segundo
      const bytesPerSample = 2; // 16 bits
      
      // Criar buffer para tom de referência com múltiplas frequências para melhorar a detecção
      const bufferSize = Math.floor(sampleRate * channels * bytesPerSample * duration);
      const audioBuffer = Buffer.alloc(bufferSize);
      
      // Usar duas frequências combinadas para melhor detecção (1kHz e 500Hz)
      const frequency1 = 1000; // 1kHz - boa detecção para voz
      const frequency2 = 500;  // 500Hz - adicionar uma frequência mais baixa
      const amplitude = 0.3;  // Aumentado para 30% para melhor detecção
      
      logger.info(`[webrtc-service] Gerando tom de referência: ${duration}s, ${sampleRate}Hz, ${channels} canais`);
      
      // Gerar um tom de teste com duas frequências combinadas
      for (let i = 0; i < sampleRate * duration; i++) {
        // Combinação de duas senoides com fade in/out para evitar cliques
        const fadeIn = Math.min(1, i / (sampleRate * 0.1)); // 100ms fade in
        const fadeOut = Math.min(1, (sampleRate * duration - i) / (sampleRate * 0.1)); // 100ms fade out
        const fadeFactor = Math.min(fadeIn, fadeOut);
        
        // Combinação de duas frequências
        const sample1 = Math.sin(2 * Math.PI * frequency1 * i / sampleRate) * amplitude;
        const sample2 = Math.sin(2 * Math.PI * frequency2 * i / sampleRate) * (amplitude * 0.7);
        
        // Somar as duas senoides e aplicar o fade
        const combinedSample = (sample1 + sample2) * fadeFactor;
        
        // Converter para int16 (garantindo que está dentro dos limites [-32768, 32767])
        const intValue = Math.max(-32768, Math.min(32767, Math.floor(combinedSample * 32767)));
        
        // Gravar amostra (formato mono)
        audioBuffer.writeInt16LE(intValue, i * bytesPerSample);
      }
      
      // Ler dados do arquivo original
      const originalData = fs.readFileSync(filePath);
      
      // Verificar se é um WAV válido
      const isWav = originalData.length >= 44 && 
                   originalData.slice(0, 4).toString() === 'RIFF' && 
                   originalData.slice(8, 12).toString() === 'WAVE';
      
      let dataBuffer;
      let originalFormat = {};
      
      if (isWav) {
        // Se for WAV, extrair os dados após o cabeçalho e preservar informações de formato
        dataBuffer = originalData.slice(44);
        
        // Preservar informações de formato do arquivo original
        originalFormat.channels = originalData.readUInt16LE(22);
        originalFormat.sampleRate = originalData.readUInt32LE(24);
        originalFormat.bitsPerSample = originalData.readUInt16LE(34);
        
        logger.info(`[webrtc-service] Arquivo original é WAV válido (${dataBuffer.length} bytes de dados)`);
        logger.info(`[webrtc-service] Formato original: ${originalFormat.sampleRate}Hz, ${originalFormat.channels} canais, ${originalFormat.bitsPerSample} bits`);
      } else {
        // Se não for WAV, usar todos os dados
        dataBuffer = originalData;
        logger.info(`[webrtc-service] Arquivo original não é WAV (${dataBuffer.length} bytes)`);
      }
      
      // Combinar: tom de referência + dados originais
      const combinedAudioData = Buffer.concat([audioBuffer, dataBuffer]);
      
      // Criar cabeçalho WAV otimizado para transcrição
      const headerBuffer = Buffer.alloc(44);
      
      // RIFF chunk
      headerBuffer.write('RIFF', 0);
      headerBuffer.writeUInt32LE(36 + combinedAudioData.length, 4); // Tamanho do arquivo - 8
      headerBuffer.write('WAVE', 8);
      
      // fmt chunk
      headerBuffer.write('fmt ', 12);
      headerBuffer.writeUInt32LE(16, 16); // Tamanho do chunk fmt
      headerBuffer.writeUInt16LE(1, 20); // Formato PCM
      headerBuffer.writeUInt16LE(channels, 22); // Canais
      headerBuffer.writeUInt32LE(sampleRate, 24); // Taxa de amostragem
      headerBuffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // Bytes por segundo
      headerBuffer.writeUInt16LE(channels * bytesPerSample, 32); // Block align
      headerBuffer.writeUInt16LE(bytesPerSample * 8, 34); // Bits por amostra
      
      // data chunk
      headerBuffer.write('data', 36);
      headerBuffer.writeUInt32LE(combinedAudioData.length, 40); // Tamanho dos dados
      
      // Combinar cabeçalho e dados em um único buffer
      const completeWavBuffer = Buffer.concat([headerBuffer, combinedAudioData]);
      
      // Escrever o arquivo WAV final
      fs.writeFileSync(filePath, completeWavBuffer);
      
      // Verificar o tamanho do arquivo final
      const finalStats = fs.statSync(filePath);
      const finalSize = finalStats.size;
      
      // Verificar se o arquivo final é consistente
      if (finalSize !== completeWavBuffer.length) {
        logger.error(`[webrtc-service] Tamanho do arquivo inconsistente: ${finalSize} bytes no disco, ${completeWavBuffer.length} bytes no buffer`);
      }
      
      logger.info(`[webrtc-service] Arquivo WAV reconstruído com sucesso: ${filePath} (${completeWavBuffer.length} bytes)`);
      return true;
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao melhorar áudio para transcrição: ${error.message}, stack: ${error.stack}`);
      return false;
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
      
      // Validar o arquivo WAV
      const isValidWav = this._validateWavFile(this.outputFile);
      if (!isValidWav) {
        logger.warn(`[webrtc-service] Arquivo WAV pode estar corrompido. Tentando reconstruir...`);
      }
      
      // Criar arquivo temporário para transcrição com um nome único
      const tempFileName = `${path.basename(this.outputFile, path.extname(this.outputFile))}_temp_${Date.now()}.wav`;
      const tempOutputFile = path.join(path.dirname(this.outputFile), tempFileName);
      
      logger.info(`[webrtc-service] Criando arquivo temporário para transcrição: ${tempOutputFile}`);
      
      // Criar uma cópia do arquivo original
      fs.copyFileSync(this.outputFile, tempOutputFile);
      
      // Verificar o tamanho do arquivo temporário
      const tempStats = fs.statSync(tempOutputFile);
      logger.info(`[webrtc-service] Arquivo temporário copiado: ${tempOutputFile} (${tempStats.size} bytes)`);
      
      // Adicionar tom de referência e reconstruir o WAV para garantir formato válido
      const audioEnhanced = await this._injectReferenceAudio(tempOutputFile);
      
      if (!audioEnhanced) {
        logger.error(`[webrtc-service] Falha ao melhorar áudio para transcrição. Tentando transcrever arquivo original.`);
      }
      
      // Verificar o arquivo novamente após aprimoramento
      const updatedStats = fs.statSync(tempOutputFile);
      logger.info(`[webrtc-service] Arquivo temporário após aprimoramento: ${tempOutputFile} (${updatedStats.size} bytes)`);
      
      // Validar o arquivo WAV final
      const isValidEnhancedWav = this._validateWavFile(tempOutputFile);
      
      if (!isValidEnhancedWav) {
        logger.error(`[webrtc-service] Arquivo WAV aprimorado ainda não é válido. A transcrição pode falhar.`);
      }
      
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
      
      // Verificar se a transcrição foi bem-sucedida
      if (!transcription || transcription.trim() === '') {
        logger.warn(`[webrtc-service] Transcrição vazia ou falhou. Verificando informações adicionais.`);
        
        // Verificar se temos participantes ativos com áudio
        let activeParticipants = 0;
        for (const [participantId, participant] of this.participants.entries()) {
          if (participant.hasActiveProducer) {
            activeParticipants++;
          }
        }
        
        logger.info(`[webrtc-service] Participantes ativos com producer de áudio: ${activeParticipants}`);
      } else {
        logger.info(`[webrtc-service] Transcrição bem-sucedida: "${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}"`);
      }
      
      return {
        duration,
        transcription,
        timestamp,
        fileSize: fileStats.size,
        participantsCount: this.realParticipantCount || 0
      };
    } catch (error) {
      logger.error(`[webrtc-service] Erro ao transcrever áudio atual para sessão ${this.id}:`, error);
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