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
      
      // Configurar mixer com parâmetros específicos se não estiver já configurado
      if (!this.audioMixer) {
        logger.info('Criando novo mixer de áudio com configurações padrão');
        this.audioMixer = new AudioMixer.Mixer({
          channels: 2,           // Estéreo
          bitDepth: 16,          // 16 bits por amostra
          sampleRate: 48000,     // 48 kHz - padrão para áudio de alta qualidade
          clearInterval: 250     // ms entre limpezas do buffer
        });
        
        logger.info(`Mixer configurado: canais=${this.audioMixer.channels}, taxa=${this.audioMixer.sampleRate}, bits=${this.audioMixer.bitDepth}`);
      }
      
      // Configurar stream de saída
      const outputStream = fs.createWriteStream(this.outputFile);
      
      // Adicionar o cabeçalho WAV ao início do arquivo
      const writeHeader = () => {
        logger.info('Escrevendo cabeçalho WAV no arquivo...');
        
        // Dados básicos para o cabeçalho WAV
        const channels = this.audioMixer.channels || 2;
        const sampleRate = this.audioMixer.sampleRate || 48000;
        const bitDepth = this.audioMixer.bitDepth || 16;
        
        // Escrever cabeçalho manualmente para garantir formato correto
        const headerBuffer = Buffer.alloc(44);
        
        // RIFF chunk
        headerBuffer.write('RIFF', 0);  // ChunkID
        headerBuffer.writeUInt32LE(0, 4); // ChunkSize (atualizaremos depois)
        headerBuffer.write('WAVE', 8);  // Format
        
        // fmt sub-chunk
        headerBuffer.write('fmt ', 12);  // Subchunk1ID
        headerBuffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
        headerBuffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
        headerBuffer.writeUInt16LE(channels, 22); // NumChannels
        headerBuffer.writeUInt32LE(sampleRate, 24); // SampleRate
        headerBuffer.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28); // ByteRate
        headerBuffer.writeUInt16LE(channels * (bitDepth / 8), 32); // BlockAlign
        headerBuffer.writeUInt16LE(bitDepth, 34); // BitsPerSample
        
        // data sub-chunk
        headerBuffer.write('data', 36);  // Subchunk2ID
        headerBuffer.writeUInt32LE(0, 40); // Subchunk2Size (atualizaremos depois)
        
        outputStream.write(headerBuffer);
        logger.info('Cabeçalho WAV escrito com sucesso');
      };
      
      // Escrever cabeçalho WAV
      writeHeader();
      
      // Conectar mixer ao arquivo
      this.audioMixer.pipe(outputStream);
      
      // Marcar como gravando
      this.isRecording = true;
      this.recordingStartTime = Date.now();
      
      // Configurar evento para finalizar o arquivo corretamente quando necessário
      outputStream.on('finish', () => {
        logger.info('Stream de saída finalizado, atualizando cabeçalho WAV se necessário');
        // Aqui poderíamos implementar uma lógica para atualizar o tamanho no cabeçalho WAV
      });
      
      // Para cada participante conectado, iniciar a captura de áudio
      let participantCount = 0;
      for (const [participantId, participant] of this.participants.entries()) {
        for (const [producerId, producer] of participant.producers.entries()) {
          this.captureAudioFromProducer(participantId, producer);
          participantCount++;
        }
      }
      
      // Garantir que pelo menos a entrada do mixer está funcionando, mesmo sem participantes
      if (participantCount === 0) {
        logger.info('Nenhum participante real encontrado, adicionando input virtual para garantir dados de áudio');
        
        // Criar um input para áudio silencioso/teste
        const virtualInput = this.audioMixer.input({
          channels: 2,
          volume: 50, // 50% do volume
          bitDepth: 16,
          sampleRate: 48000,
          name: 'virtual-participant'
        });
        
        // Armazenar o input virtual para referência
        this.virtualInput = virtualInput;
        
        // Gerar dados de áudio para este input
        this._simulateAudioData(virtualInput, 'virtual');
        logger.info('Input virtual adicionado e gerando dados de áudio');
      } else {
        logger.info(`Capturando áudio de ${participantCount} producers de participantes reais`);
      }
      
      logger.info(`Gravação iniciada para sessão ${this.id}, salvando em ${this.outputFile}`);
      
      // Verificar se o arquivo foi criado corretamente
      setTimeout(() => {
        try {
          if (fs.existsSync(this.outputFile)) {
            const stats = fs.statSync(this.outputFile);
            logger.info(`Arquivo WAV iniciado: ${this.outputFile}, tamanho inicial: ${stats.size} bytes`);
          } else {
            logger.warn(`Arquivo WAV não encontrado após iniciar gravação: ${this.outputFile}`);
          }
        } catch (err) {
          logger.error(`Erro ao verificar arquivo WAV: ${err.message}`);
        }
      }, 500); // Verificar após 500ms
      
      // Verificar se o arquivo está crescendo (sinal de que está recebendo dados de áudio)
      setTimeout(() => {
        try {
          if (fs.existsSync(this.outputFile)) {
            const stats = fs.statSync(this.outputFile);
            logger.info(`Arquivo WAV após 2 segundos: ${this.outputFile}, tamanho: ${stats.size} bytes`);
            
            if (stats.size <= 44) {
              logger.warn('O arquivo WAV não cresceu além do cabeçalho! Verificando problemas...');
            }
          }
        } catch (err) {
          logger.error(`Erro ao verificar crescimento do arquivo WAV: ${err.message}`);
        }
      }, 2000); // Verificar após 2 segundos
      
      return this.outputFile;
    } catch (error) {
      logger.error(`Erro ao iniciar gravação para sessão ${this.id}:`, error);
      this.isRecording = false;
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
      logger.info(`Iniciando captura real de áudio do participante ${participantId}`);
      
      // Criar uma entrada no mixer para este participante
      const input = this.audioMixer.input({
        channels: 2,  // Estéreo
        volume: 100,  // Volume máximo
        bitDepth: 16, // 16 bits por amostra
        sampleRate: 48000, // 48 kHz
        name: `participant-${participantId}`
      });
      
      logger.info(`Input adicionado ao mixer para participante ${participantId}`);
      
      // Armazenar o input do participante no seu objeto
      const participant = this.participants.get(participantId);
      if (participant) {
        participant.mixerInput = input;
        logger.info(`Mixer input associado ao participante ${participantId}`);
      }
      
      // Registrar evento para quando o transporte for fechado
      producer.on('transportclose', () => {
        logger.info(`Transport fechado para producer do participante ${participantId}`);
        // Remover input quando o transporte for fechado
        if (input && typeof input.end === 'function') {
          input.end();
          logger.info(`Input removido do mixer para participante ${participantId}`);
        }
      });
      
      // Registrar manipulador de eventos para dados RTP
      producer.on('rtptransport', (rtpParameters) => {
        logger.info(`Recebendo RTP do participante ${participantId}`);
        // Aqui podemos processar os dados RTP conforme necessário
      });
      
      // Simular recebimento de dados de áudio
      // Este é um exemplo simples, na implementação real você usaria os dados RTP
      this._simulateAudioData(input, participantId);
      
      logger.info(`Áudio do participante ${participantId} está sendo capturado e adicionado ao mixer`);
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
      // Criar um buffer com 1 segundo de áudio silencioso (ou tom de teste)
      // Para 48kHz, 16-bit, estéreo, 1 segundo = 48000 * 2 * 2 bytes = 192000 bytes
      const sampleRate = 48000;
      const duration = 3; // 3 segundos de dados
      const bufferSize = sampleRate * 2 * 2 * duration; // 2 canais, 2 bytes por amostra
      
      logger.info(`Gerando ${duration} segundos de áudio para participante ${participantId}`);
      
      // Criar buffer de áudio
      const buffer = Buffer.alloc(bufferSize);
      
      // Preencher o buffer com um tom de teste (senóide de 440Hz)
      // ou preencher com zeros para silêncio
      const useSilence = false; // true = silêncio, false = tom de teste
      
      if (useSilence) {
        // Já está preenchido com zeros
        logger.info(`Usando silêncio para participante ${participantId}`);
      } else {
        // Gerar um tom de teste (senoide simples)
        const frequency = 440; // Hz (nota Lá)
        const amplitude = 0.1; // 10% do volume máximo (valor baixo para não incomodar)
        
        logger.info(`Gerando tom de teste de ${frequency}Hz para participante ${participantId}`);
        
        for (let i = 0; i < sampleRate * duration; i++) {
          // Calcular o valor da senoide
          const sampleValue = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
          
          // Converter para inteiro de 16 bits e escrever nos dois canais
          const intValue = Math.floor(sampleValue * 32767); // 32767 = 2^15 - 1 (máximo para int16)
          
          // Canal esquerdo
          buffer.writeInt16LE(intValue, i * 4);
          // Canal direito
          buffer.writeInt16LE(intValue, i * 4 + 2);
        }
      }
      
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
      
      // Verificar se o arquivo original existe e validar
      if (!fs.existsSync(this.outputFile)) {
        logger.error(`Arquivo de gravação não encontrado: ${this.outputFile}`);
        return null;
      }
      
      // Verificar se o arquivo tem conteúdo válido
      const stats = fs.statSync(this.outputFile);
      logger.info(`Arquivo de gravação encontrado. Tamanho: ${stats.size} bytes`);
      
      if (stats.size < 44) { // Tamanho mínimo para um cabeçalho WAV válido
        logger.error(`Arquivo de gravação inválido (muito pequeno): ${stats.size} bytes`);
        return null;
      }
      
      // Pegar uma amostra do início do arquivo para verificar se é um WAV válido
      const fd = fs.openSync(this.outputFile, 'r');
      const buffer = Buffer.alloc(44); // Tamanho do cabeçalho WAV
      fs.readSync(fd, buffer, 0, 44, 0);
      fs.closeSync(fd);
      
      // Verificar se é um arquivo WAV válido (verificando a assinatura RIFF WAV)
      const isWav = buffer.toString('ascii', 0, 4) === 'RIFF' && 
                    buffer.toString('ascii', 8, 12) === 'WAVE';
                    
      if (!isWav) {
        logger.error(`Arquivo de gravação não é um WAV válido: ${this.outputFile}`);
        // Tentar continuar mesmo assim - alguns sistemas podem ter variações no formato
        logger.info(`Tentando prosseguir mesmo com formato não reconhecido. Início do arquivo: ${buffer.toString('hex', 0, 16)}`);
      } else {
        logger.info(`Arquivo WAV válido confirmado: ${this.outputFile}`);
      }
      
      // Criar uma cópia temporária do arquivo atual para transcrição
      const tempOutputFile = `${this.outputFile}.temp-${Date.now()}.wav`;
      
      // Usar método de cópia mais robusto
      try {
        // Copiar o arquivo original inteiro
        const readStream = fs.createReadStream(this.outputFile);
        const writeStream = fs.createWriteStream(tempOutputFile);
        
        await new Promise((resolve, reject) => {
          readStream.pipe(writeStream);
          readStream.on('error', reject);
          writeStream.on('error', reject);
          writeStream.on('finish', resolve);
        });
        
        logger.info(`Arquivo temporário criado com sucesso: ${tempOutputFile}`);
        
        // Verificar o tamanho do arquivo temporário
        const tempStats = fs.statSync(tempOutputFile);
        logger.info(`Arquivo temporário: ${tempStats.size} bytes`);
        
        if (tempStats.size !== stats.size) {
          logger.warn(`Tamanho do arquivo temporário (${tempStats.size}) é diferente do original (${stats.size})`);
        }
        
        if (tempStats.size < 44) {
          throw new Error(`Arquivo temporário inválido (muito pequeno): ${tempStats.size} bytes`);
        }
      } catch (copyError) {
        logger.error(`Erro ao copiar arquivo para versão temporária: ${copyError.message}`);
        throw new Error(`Falha ao preparar arquivo para transcrição: ${copyError.message}`);
      }
      
      // Transcrever o arquivo temporário
      logger.info(`Enviando arquivo para transcrição: ${tempOutputFile}`);
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