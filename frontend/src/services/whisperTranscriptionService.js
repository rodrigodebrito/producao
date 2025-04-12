/**
 * WhisperTranscriptionService
 * Serviço para gravar áudio, converter formatos e enviar para a API Whisper
 * Com detecção automática de silêncio e envio de chunks
 * Agora captura áudio de todos os participantes no Daily.co
 */
import { WHISPER_URL, API_URL } from '../config';

class WhisperTranscriptionService {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.audioStream = null;
    this.isRecording = false;
    
    // Usar a URL configurada na configuração global para garantir consistência
    this.apiEndpoint = 'https://theraconnect-prd.onrender.com/api/ai/whisper/transcribe';
    this.transcriptEndpoint = 'https://theraconnect-prd.onrender.com/api/ai/transcript';
    
    this.transcriptionInProgress = false;
    this.useCredentials = false; // Por padrão, NÃO enviar credenciais para testes
    this.supportedMimeTypes = [
      'audio/wav', 
      'audio/mp3', 
      'audio/mpeg', 
      'audio/mp4', 
      'audio/webm', 
      'audio/ogg'
    ];
    this.currentFileName = null;
    
    // Configurações para detecção de silêncio - AJUSTADO PARA SER MENOS SENSÍVEL
    this.silenceDetectionEnabled = true;
    this.silenceThreshold = -60; // dB (mais negativo = mais sensível) - AJUSTADO PARA -60
    this.silenceDuration = 15000; // AJUSTADO: 15 segundos de silêncio para enviar e parar
    this.maxChunkDuration = 30000; // AJUSTADO: 30 segundos máximos por chunk
    this.minChunkDuration = 1500; // 1.5 segundos mínimos por chunk
    
    // Estado de detecção de silêncio
    this.audioContext = null;
    this.audioAnalyser = null;
    this.silenceDetector = null;
    this.silenceStart = null;
    this.silenceTimer = null;
    this.chunkStartTime = null;
    this.maxChunkTimer = null;
    
    // Estado de transcrição contínua
    this.transcriptionHistory = [];
    this.sessionId = '3be9d267-da13-4841-b2f1-c8deb15c8e17'; // ID da sessão atual para uso com API
    
    // Contador de chunks
    this.chunkCounter = 0;

    // Adicionar configuração para controlar o reinício automático
    this.autoRestart = true; // AJUSTADO: Sempre reiniciar por padrão
    
    // NOVO: Flag para verificar se estamos em pausa por silêncio
    this.pausedForSilence = false;
    
    // NOVO: Configuração para detecção de voz após pausa - AJUSTADO PARA SER MENOS SENSÍVEL
    this.voiceDetectionEnabled = true;
    this.voiceThreshold = -50; // dB (menos sensível que o silêncio) - AJUSTADO PARA -50
    this.voiceDetectionInterval = null;

    // NOVO: Variáveis para suporte ao Daily.co
    this.dailyCapturingEnabled = false;
    this.dailyEventListenerAdded = false;
    
    // Adicionar listener para mensagens do iframe do Daily se estiver em produção
    if (window.location.hostname !== 'localhost') {
      this._setupDailyMessageListener();
    }
  }

  /**
   * Extrai o sessionId da URL atual
   * @returns {string} sessionId
   */
  extractSessionId() {
    try {
      // Tentar extrair da URL
      const url = window.location.href;
      console.log('Whisper: Extraindo sessionId de URL:', url);
      
      // 1. Verificar padrão /session/{id} (padrão principal)
      const sessionMatch = url.match(/\/session\/([a-zA-Z0-9_-]+)/);
      if (sessionMatch && sessionMatch[1]) {
        console.log('Whisper: SessionId extraído da URL (padrão /session/):', sessionMatch[1]);
        return sessionMatch[1];
      }
      
      // 2. Verificar padrão de UUID/GUID na URL
      const uuidMatch = url.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
      if (uuidMatch && uuidMatch[0]) {
        console.log('Whisper: SessionId extraído da URL (formato UUID):', uuidMatch[0]);
        return uuidMatch[0];
      }
      
      // 3. Obter do localStorage ou sessionStorage
      const savedSessionId = localStorage.getItem('currentSessionId') || sessionStorage.getItem('currentSessionId');
      if (savedSessionId) {
        console.log('Whisper: SessionId obtido do storage:', savedSessionId);
        return savedSessionId;
      }
      
      // 4. Gerar ID temporário com mais informação
      const tempId = `temp_${Date.now()}`;
      console.log('Whisper: Usando ID temporário:', tempId);
      return tempId;
    } catch (e) {
      console.error('Whisper: Erro ao extrair sessionId:', e);
      return `error_${Date.now()}`;
    }
  }

  /**
   * NOVO: Configura o listener de mensagens do Daily
   * @private
   */
  _setupDailyMessageListener() {
    if (this.dailyEventListenerAdded) return;
    
    window.addEventListener('message', (event) => {
      try {
        // Verificar se a mensagem vem do Daily
        if (!event.data || typeof event.data !== 'object' || !event.data.type) return;
        
        // Processar mensagens relacionadas ao áudio
        if (event.data.type === 'daily-audio-data') {
          this._handleDailyAudioData(event.data);
        }
      } catch (e) {
        console.error('Erro ao processar mensagem do Daily:', e);
      }
    });
    
    this.dailyEventListenerAdded = true;
    console.log('Listener de mensagens do Daily configurado');
  }
  
  /**
   * NOVO: Processa dados de áudio enviados pelo Daily
   * @param {Object} data - Dados da mensagem
   * @private
   */
  _handleDailyAudioData(data) {
    try {
      if (!data.audioBlob || !this.isRecording) return;
      
      // Converter dados Base64 para Blob se necessário
      let audioBlob;
      if (typeof data.audioBlob === 'string') {
        // Converter Base64 para Blob
        const byteString = atob(data.audioBlob.split(',')[1]);
        const mimeString = data.audioBlob.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        
        audioBlob = new Blob([ab], { type: mimeString });
      } else {
        audioBlob = data.audioBlob;
      }
      
      // Adicionar à lista de chunks
      this.audioChunks.push(audioBlob);
      
      console.log(`Áudio do Daily recebido: ${Math.round(audioBlob.size/1024)}KB, participante: ${data.participantId || 'desconhecido'}`);
    } catch (e) {
      console.error('Erro ao processar dados de áudio do Daily:', e);
    }
  }
  
  /**
   * NOVO: Tenta ativar a captura de áudio do Daily
   * @returns {Promise<boolean>} Sucesso da ativação
   * @private
   */
  async _tryEnableDailyCapture() {
    try {
      // Verificar se já está ativado
      if (this.dailyCapturingEnabled) {
        console.log('Captura do Daily já está ativada');
        return true;
      }
      
      // Verificar se está em produção
      if (window.location.hostname === 'localhost') {
        console.log('Em ambiente de desenvolvimento, não tentando comunicação com Daily');
        return false;
      }
      
      // Garantir que o listener está configurado
      this._setupDailyMessageListener();
      
      // Buscar iframes do Daily
      const dailyIframes = Array.from(document.querySelectorAll('iframe'))
        .filter(iframe => 
          iframe.src && (
            iframe.src.includes('daily.co') || 
            iframe.src.includes('terapiaconect') ||
            iframe.id.includes('daily') ||
            iframe.className.includes('daily')
          )
        );
      
      console.log(`Encontrados ${dailyIframes.length} possíveis iframes do Daily`);
      
      if (dailyIframes.length > 0) {
        // Enviar mensagem para ativar captura
        dailyIframes.forEach(iframe => {
          try {
            console.log(`Enviando mensagem para iframe: ${iframe.src}`);
            
            // Enviar mensagem de forma segura
            iframe.contentWindow.postMessage({
              type: 'whisper-request-audio-capture',
              sessionId: this.sessionId
            }, '*');
          } catch (e) {
            console.warn(`Não foi possível enviar mensagem para iframe: ${e.message}`);
          }
        });
        
        // Marcar como ativado (mesmo que não tenhamos garantia de resposta)
        this.dailyCapturingEnabled = true;
        console.log('Solicitação de captura enviada para iframes do Daily');
        return true;
      }
      
      return false;
    } catch (e) {
      console.error('Erro ao tentar ativar captura do Daily:', e);
      return false;
    }
  }

  /**
   * Inicia o processo de gravação de áudio
   * @param {string} [sessionId=null] - ID da sessão (opcional)
   * @returns {Promise<boolean>} - true se iniciou com sucesso
   */
  async startRecording(sessionId = null) {
    try {
      console.log('=== INICIANDO NOVA GRAVAÇÃO WAV ===');
      
      // Limpar qualquer recurso existente antes de começar
      await this._releaseAllAudioResources();
      
      console.log('Pausa adicional para garantir liberação total...');
      await this._wait(300); // Pequena pausa para garantir que os recursos foram liberados
      
      // Atualizar ID da sessão se fornecido
      if (sessionId) {
        this.updateSessionId(sessionId);
      }
      
      // Tentar capturar áudio do Daily.co primeiro
      const dailySuccess = await this._captureAudioFromDaily();
      
      if (dailySuccess) {
        console.log('Daily.co ativado com sucesso, usando apenas áudio do Daily');
        // Criar um stream de áudio silencioso apenas para manter o formato de processamento
        const silentStream = this._createSilentAudioStream();
        this.audioStream = silentStream;
        console.log('Stream de áudio silencioso criado com sucesso');
      } else {
        // Fallback: usar captura de áudio local
        console.log('Daily.co não disponível, tentando captura de áudio local...');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
        
        this.audioStream = stream;
        console.log('Áudio local capturado com sucesso');
      }
      
      // Configurar contexto de áudio para análise
      await this._setupAudioContext();
      
      // Obter MIME type suportado
      const mimeType = this._getSupportedMimeType();
      console.log(`Formato de gravação selecionado: ${mimeType}`);
      
      // Criar gravador
      this.mediaRecorder = new MediaRecorder(this.audioStream, {
        mimeType,
        audioBitsPerSecond: 128000 // 128kbps
      });
      
      // Configurar manipuladores de eventos
      this._setupRecorderEvents();
      
      // Iniciar gravação
      this.mediaRecorder.start();
      this.isRecording = true;
      console.log('Gravação WAV iniciada com nova instância de MediaRecorder');
      
      // Iniciar contagem de tempo para este chunk
      this.chunkStartTime = Date.now();
      this.chunkCounter++;
      
      // Configurar detector de silêncio
      if (this.silenceDetectionEnabled) {
        this._setupSilenceDetection();
        console.log('Detecção de silêncio configurada');
      }
      
      // Configurar timer para tamanho máximo de chunk
      if (this.maxChunkDuration > 0) {
        this.maxChunkTimer = setTimeout(() => {
          console.log(`Duração máxima de chunk atingida (${this.maxChunkDuration/1000}s), processando áudio...`);
          this._processCurrentChunk();
        }, this.maxChunkDuration);
      }
      
      // Notificar que a gravação começou
      this._dispatchEvent('recordingStarted', { 
        isRecording: true,
        timestamp: new Date().toISOString()
      });
      
      return true;
    } catch (error) {
      console.error('Erro ao iniciar gravação:', error);
      this._dispatchEvent('recordingError', { error: error.message });
      return false;
    }
  }

  /**
   * Método auxiliar para esperar um tempo determinado
   * @param {number} ms - Tempo em milissegundos
   * @returns {Promise<void>}
   * @private
   */
  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Configura manipuladores de eventos para o MediaRecorder
   * @private
   */
  _setupRecorderEvents() {
    if (!this.mediaRecorder) return;
    
    // Configurar evento para capturar chunks de áudio
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        const chunkNum = this.audioChunks.length;
        const sizeKB = Math.round(event.data.size/1024);
        console.log(`Chunk #${chunkNum} recebido: ${sizeKB}KB, tipo: ${event.data.type}`);
        this.audioChunks.push(event.data);
      }
    };
    
    // Configurar evento para lidar com erros
    this.mediaRecorder.onerror = (event) => {
      console.error('Erro no MediaRecorder:', event);
      this._dispatchEvent('recordingError', { error: 'Erro na gravação de áudio' });
    };
  }

  /**
   * Obtém o tipo MIME suportado para gravação de áudio
   * @returns {string} Tipo MIME suportado
   * @private
   */
  _getSupportedMimeType() {
    const mimeTypes = [
      'audio/wav',
      'audio/webm',
      'audio/mp3',
      'audio/mpeg',
      'audio/ogg'
    ];
    
    for (const type of mimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    
    return 'audio/webm'; // Fallback padrão
  }

  /**
   * Configura o contexto de áudio para análise
   * @returns {Promise<void>}
   * @private
   */
  async _setupAudioContext() {
    try {
      // Criar contexto de áudio se não existir
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // Criar analisador se não existir
      if (!this.audioAnalyser) {
        this.audioAnalyser = this.audioContext.createAnalyser();
        this.audioAnalyser.fftSize = 2048;
        this.audioAnalyser.smoothingTimeConstant = 0.8;
      }
      
      // Conectar stream ao analisador
      if (this.audioStream && this.audioStream.getAudioTracks().length > 0) {
        const source = this.audioContext.createMediaStreamSource(this.audioStream);
        source.connect(this.audioAnalyser);
      }
    } catch (error) {
      console.error('Erro ao configurar contexto de áudio:', error);
    }
  }

  /**
   * Captura áudio do Daily.co
   * @returns {Promise<boolean>} Sucesso da captura
   * @private
   */
  async _captureAudioFromDaily() {
    try {
      // Verificar se já está ativado
      if (this.dailyCapturingEnabled) {
        console.log('Captura do Daily já está ativada');
        return true;
      }
      
      // Verificar se está em produção
      if (window.location.hostname === 'localhost') {
        console.log('Em ambiente de desenvolvimento, não tentando comunicação com Daily');
        return false;
      }
      
      // Tenta ativar a captura do Daily
      const success = await this._tryEnableDailyCapture();
      
      return success;
    } catch (error) {
      console.error('Erro ao capturar áudio do Daily:', error);
      return false;
    }
  }

  /**
   * Cria um stream de áudio silencioso
   * @returns {MediaStream} Stream de áudio silencioso
   * @private
   */
  _createSilentAudioStream() {
    try {
      // Criar contexto de áudio
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Criar um oscilador com frequência muito baixa
      const oscillator = audioContext.createOscillator();
      oscillator.frequency.value = 1; // 1 Hz - quase inaudível
      
      // Criar um nó de ganho para controlar o volume
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.001; // Volume praticamente zero
      
      // Conectar o oscilador ao ganho e o ganho à saída
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Iniciar o oscilador
      oscillator.start();
      
      // Criar um MediaStream a partir do destino
      const streamDestination = audioContext.createMediaStreamDestination();
      
      return streamDestination.stream;
    } catch (error) {
      console.error('Erro ao criar stream de áudio silencioso:', error);
      
      // Criar um stream vazio como alternativa
      return new MediaStream();
    }
  }

  /**
   * NOVO: Método para liberar completamente todos os recursos de áudio
   * @private
   */
  async _releaseAllAudioResources() {
    console.log('Liberando TODOS os recursos de áudio...');
    
    // 1. Limpar MediaRecorder
    if (this.mediaRecorder) {
      try {
        // Se estiver gravando, parar
        if (this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.stop();
        }
        
        // Remover todos os event listeners
        this.mediaRecorder.ondataavailable = null;
        this.mediaRecorder.onstop = null;
        this.mediaRecorder.onerror = null;
        
        // Definir como null para incentivar garbage collection
        this.mediaRecorder = null;
      } catch (e) {
        console.warn('Erro ao liberar MediaRecorder:', e);
      }
    }
    
    // 2. Limpar stream de áudio
    if (this.audioStream) {
      try {
        // Parar todas as tracks
        this.audioStream.getTracks().forEach(track => {
          try { 
            track.stop(); 
            console.log('Track de áudio parada e liberada');
          } catch (e) {
            console.warn('Erro ao parar track de áudio:', e);
          }
        });
        
        // Definir como null para incentivar garbage collection
        this.audioStream = null;
      } catch (e) {
        console.warn('Erro ao liberar stream de áudio:', e);
      }
    }
    
    // 3. Limpar contexto de áudio
    if (this.audioContext) {
      try {
        // Fechar o contexto de áudio
        await this.audioContext.close();
        console.log('Contexto de áudio fechado');
        
        // Definir como null para incentivar garbage collection
        this.audioContext = null;
        this.audioAnalyser = null;
      } catch (e) {
        console.warn('Erro ao fechar contexto de áudio:', e);
      }
    }
    
    // 4. Limpar temporizadores
    if (this.maxChunkTimer) {
      clearTimeout(this.maxChunkTimer);
      this.maxChunkTimer = null;
    }
    
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    
    // 5. Sugerir garbage collection
    if (window.gc) {
      try {
        window.gc();
        console.log('Garbage collection solicitada');
      } catch (e) {}
    }
    
    console.log('Liberação de recursos concluída');
  }

  /**
   * Configurar o timer para chunk máximo
   * @private
   */
  _setupMaxChunkTimer() {
    // Limpar qualquer timer existente
    if (this.maxChunkTimer) {
      clearTimeout(this.maxChunkTimer);
    }
    
    // Configurar novo timer
    this.maxChunkTimer = setTimeout(() => {
      console.log(`Chunk máximo de ${this.maxChunkDuration/1000}s atingido, processando áudio...`);
      this._processCurrentChunk();
    }, this.maxChunkDuration);
  }

  /**
   * Configurar detecção de silêncio
   * @param {MediaStream} stream - Stream de áudio
   * @private
   */
  _setupSilenceDetection(stream) {
    try {
      // Criar contexto de áudio
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.audioAnalyser = this.audioContext.createAnalyser();
      
      // Configurar analisador
      this.audioAnalyser.fftSize = 2048;
      this.audioAnalyser.smoothingTimeConstant = 0.8;
      
      // Conectar stream ao analisador
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.audioAnalyser);
      
      // Iniciar detecção
      this._detectSilence();
      
      console.log('Detecção de silêncio configurada');
    } catch (error) {
      console.error('Erro ao configurar detecção de silêncio:', error);
    }
  }

  /**
   * Detecta silêncio no áudio e processa chunks quando necessário
   * @private
   */
  _detectSilence() {
    if (!this.audioAnalyser || !this.isRecording) return;
    
    // Criar buffer para análise
    const bufferLength = this.audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Obter dados de volume
    this.audioAnalyser.getByteFrequencyData(dataArray);
    
    // Calcular volume médio
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;
    
    // Converter para dB (approximation)
    const volumeDb = 20 * Math.log10(average / 255);
    
    // Determinar se é silêncio
    const isSilence = volumeDb < this.silenceThreshold;
    
    // Verificar duração da gravação atual
    const currentDuration = Date.now() - this.chunkStartTime;
    
    if (isSilence) {
      // Iniciar contagem de silêncio se ainda não começou
      if (!this.silenceStart) {
        this.silenceStart = Date.now();
        console.log('Silêncio detectado, iniciando contagem...');
      }
      
      // Verificar se o silêncio durou o suficiente
      const silenceDuration = Date.now() - this.silenceStart;
      
      // Mostrar progresso do silêncio a cada segundo
      if (silenceDuration % 1000 < 100) {
        console.log(`Silêncio: ${Math.round(silenceDuration/1000)}s / ${this.silenceDuration/1000}s`);
      }
      
      if (silenceDuration >= this.silenceDuration && currentDuration >= this.minChunkDuration) {
        // Silêncio suficiente e chunk com duração mínima, processar áudio
        console.log(`Silêncio atingiu ${Math.round(silenceDuration/1000)}s, processando áudio e pausando gravação...`);
        
        // CORREÇÃO: Resetar o contador de silêncio imediatamente para evitar loops
        this.silenceStart = null;
        
        // Processar o chunk atual apenas se houver chunks válidos
        if (this.audioChunks && this.audioChunks.length > 0) {
          this._processCurrentChunk();
          
          // NOVO: Pausar gravação por inatividade
          this._pauseRecordingForSilence();
        } else {
          console.log('Detectado silêncio prolongado, mas não há áudio para processar. Continuando gravação...');
          
          // Continuar detecção
          requestAnimationFrame(() => this._detectSilence());
          return;
        }
        
        return; // Não continuar a detecção
      }
    } else {
      // Se detectou voz, resetar detecção de silêncio
      if (this.silenceStart) {
        console.log('Voz detectada, reiniciando contagem de silêncio');
        this.silenceStart = null;
      }
    }
    
    // Continuar detecção
    requestAnimationFrame(() => this._detectSilence());
  }

  /**
   * Processa o chunk atual e envia para transcrição
   * @private
   */
  async _processCurrentChunk() {
    try {
      // Verificar se temos chunks para processar
      if (!this.audioChunks || this.audioChunks.length === 0) {
        console.log('Nenhum chunk de áudio para processar');
        return;
      }
      
      // Verificar duração da gravação atual
      const duration = Date.now() - this.chunkStartTime;
      
      // Se a duração for menor que o mínimo, ignorar
      if (duration < this.minChunkDuration) {
        console.log(`Duração muito curta (${Math.round(duration/1000)}s), mínimo é ${Math.round(this.minChunkDuration/1000)}s. Ignorando chunk.`);
        return;
      }
      
      // Verificar se há dados de áudio válidos nos chunks
      let hasValidAudio = false;
      for (const chunk of this.audioChunks) {
        if (chunk && chunk.size > 0) {
          hasValidAudio = true;
          break;
        }
      }
      
      if (!hasValidAudio) {
        console.log('Todos os chunks de áudio estão vazios, ignorando processamento');
        return;
      }
      
      console.log(`Processando chunk com duração de ${Math.round(duration/1000)}s`);
      
      // Limpar temporizadores
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      
      if (this.maxChunkTimer) {
        clearTimeout(this.maxChunkTimer);
        this.maxChunkTimer = null;
      }
      
      // Detectar formato original
      const originalMimeType = this.audioChunks[0]?.type || 'unknown';
      console.log(`Tipo MIME original do chunk: ${originalMimeType}`);
      
      // SEMPRE usar WAV para envio ao Whisper
      const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
      
      console.log(`Chunk #${this.chunkCounter} criado: tamanho=${Math.round(audioBlob.size/1024)}KB, formato para envio: WAV`);
      
      // Verificar tamanho mínimo
      if (audioBlob.size < 1024) {
        console.log('Chunk de áudio muito pequeno, ignorando');
        return;
      }
      
      // Criar nome único de arquivo com extensão WAV
      const timestamp = Date.now();
      const randomId = Math.floor(Math.random() * 10000);
      const fileName = `audio-${timestamp}-${randomId}.wav`;
      
      // Enviar para processamento
      await this.processAudioChunks(audioBlob, fileName);
      
      // Limpar chunks processados e reiniciar gravação
      this._resetRecording();
    } catch (error) {
      console.error('Erro ao processar chunk de áudio:', error);
      this._dispatchEvent('recordingError', { error: error.message });
    }
  }

  /**
   * Reseta o estado de gravação
   * @private
   */
  _resetRecording() {
    // Incrementar contador de chunks processados
    this.chunkCounter++;
    
    // Limpar chunks de áudio
    this.audioChunks = [];
    
    // Reiniciar o tempo de início do novo chunk
    this.chunkStartTime = Date.now();
    
    // Reiniciar o temporizador de silêncio
    this.lastAudioLevel = 0;
    this.silenceStart = null;
    
    // Reiniciar o temporizador de chunk máximo
    this._setupMaxChunkTimer();
    
    console.log(`Gravação resetada para chunk #${this.chunkCounter}`);
  }

  /**
   * Para a gravação e processa o áudio capturado
   * @param {boolean} processCurrentChunk - Se deve processar o chunk atual
   * @returns {Promise<void>}
   */
  async stopRecording(processCurrentChunk = true) {
    console.log('=== PARANDO GRAVAÇÃO WAV ===');
    
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      console.warn('Nenhuma gravação em andamento para parar');
      return;
    }
    
    try {
      // 1. Capturar referência aos chunks antes de limpar
      const finalAudioChunks = [...this.audioChunks];
      
      // 2. Parar gravação com segurança
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        try {
          await new Promise((resolve) => {
            const stopTimeout = setTimeout(() => {
              console.warn('Timeout ao parar gravação, continuando mesmo assim');
              resolve();
            }, 3000);
            
            const stopHandler = () => {
              clearTimeout(stopTimeout);
              resolve();
            };
            
            this.mediaRecorder.onstop = stopHandler;
            
            try {
              this.mediaRecorder.stop();
            } catch (e) {
              console.warn('Erro ao parar MediaRecorder:', e);
              clearTimeout(stopTimeout);
              resolve();
            }
          });
          
          console.log('MediaRecorder parado com sucesso');
        } catch (e) {
          console.warn('Erro ao aguardar parada do MediaRecorder:', e);
        }
      }
      
      // 3. Liberar TODOS os recursos de áudio
      await this._releaseAllAudioResources();
      
      // 4. Atualizar estado
      this.isRecording = false;
      
      // 5. Notificar que a gravação foi interrompida
      this._dispatchEvent('recordingStopped', { isRecording: false });
      
      // 6. Processar o áudio capturado se solicitado
      if (processCurrentChunk && finalAudioChunks.length > 0) {
        console.log(`Processando ${finalAudioChunks.length} chunks de áudio após parada`);
        
        // Filtrar chunks vazios
        const validChunks = finalAudioChunks.filter(chunk => chunk && chunk.size > 0);
        
        if (validChunks.length === 0) {
          console.warn('Nenhum chunk válido para processar');
          return;
        }
        
        // Aguardar liberação de recursos
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Criar blob unificado com formato WAV
        const audioBlob = new Blob(validChunks, { type: 'audio/wav' });
        
        if (audioBlob.size < 1024) {
          console.warn('Arquivo de áudio muito pequeno (menos de 1KB), ignorando');
          return;
        }
        
        // Gerar nome de arquivo único
        const timestamp = Date.now();
        const randomId = Math.floor(Math.random() * 100000);
        const fileName = `audio-${timestamp}-${randomId}.wav`;
        
        // Processar o blob
        console.log(`Enviando áudio WAV final: ${fileName}, tamanho: ${Math.round(audioBlob.size/1024)}KB`);
        this.currentFileName = fileName;
        await this.processAudioChunks(audioBlob, fileName);
        
        // Liberar referência
        this.currentFileName = null;
      }
      
    } catch (error) {
      console.error('Erro ao parar gravação:', error);
      this._dispatchEvent('recordingError', { error: error.message });
    }
  }

  /**
   * Processa os chunks de áudio e os envia para o servidor
   * @param {Blob} audioBlob - O blob de áudio a ser processado
   * @param {string} fileName - O nome do arquivo
   * @returns {Promise<void>}
   */
  async processAudioChunks(audioBlob, fileName) {
    try {
      // 1. Verificar se temos um blob válido
      if (!audioBlob || audioBlob.size === 0) {
        console.error('Blob de áudio inválido ou vazio');
        return;
      }
      
      // 2. Detectar se é o primeiro áudio ou subsequente
      const isFirstAudio = this.chunkCounter === 0;
      
      // 3. ESTRATÉGIA DIFERENCIADA:
      // - Primeiro áudio: enviar como WAV (funciona consistentemente)
      // - Áudios subsequentes: enviar como MP3 (mais estável para processamento)
      const mimeType = 'audio/webm'; // Usar webm que é mais compatível com streaming
      const extension = '.webm';
      
      console.log(`Estratégia: Enviando áudio #${this.chunkCounter} como WEBM (mais compatível)`);
      
      // 4. Garantir nome de arquivo único com identificação clara
      const finalFileName = `audio-${this.chunkCounter}-${Date.now()}-${Math.floor(Math.random() * 10000)}${extension}`;
      
      // 5. Limitar o tamanho do blob para prevenir problemas HTTP/2
      let blobToSend = audioBlob;
      
      // Se o blob for maior que 1MB, reduzir a qualidade
      if (audioBlob.size > 1024 * 1024) {
        console.log(`Áudio grande detectado (${Math.round(audioBlob.size/1024)}KB), convertendo para qualidade menor`);
        try {
          // Usar abordagem com XMLHttpRequest em vez de fetch (mais estável para uploads grandes)
          return await this._sendAudioWithXHR(blobToSend, finalFileName);
        } catch (conversionError) {
          console.warn('Erro ao converter áudio, tentando enviar original:', conversionError);
          // Continuar com o blob original se a conversão falhar
        }
      }
      
      console.log(`Enviando áudio como WEBM: ${finalFileName}, tamanho: ${Math.round(blobToSend.size/1024)}KB`);
      
      // 6. Disparar evento de processamento
      this._dispatchEvent('processingAudio', {
        fileName: finalFileName,
        size: blobToSend.size,
        format: mimeType,
        isFirstChunk: isFirstAudio,
        chunkCounter: this.chunkCounter,
        duration: Math.round((Date.now() - this.chunkStartTime) / 1000)
      });
      
      // 7. Verificar se já existe transcrição em andamento
      if (this.transcriptionInProgress) {
        console.log('Transcrição já em andamento, aguardando...');
        await new Promise(resolve => {
          const startTime = Date.now();
          const checkInterval = setInterval(() => {
            if (!this.transcriptionInProgress || Date.now() - startTime > 10000) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 500);
        });
      }
      
      // 8. Enviar para o backend usando XMLHttpRequest em vez de fetch
      try {
        this.transcriptionInProgress = true;
        
        console.log(`Tentando enviar áudio via XHR: ${this.apiEndpoint}, formato: ${mimeType}, arquivo: ${finalFileName}`);
        
        // Usar XHR pode evitar problemas HTTP/2 em certos navegadores
        return await this._sendAudioWithXHR(blobToSend, finalFileName);
        
      } catch (xhrError) {
        console.error('Erro ao enviar áudio via XHR:', xhrError);
        
        // Se o XHR falhar, tentar enviar com Fetch (método alternativo)
        try {
          console.log('Tentando método alternativo (fetch) após falha de XHR');
          
          // Preparar FormData
          const formData = new FormData();
          formData.append('file', blobToSend, finalFileName);
          formData.append('sessionId', 'f275c5c4-fb58-40e3-9710-2c95e30741b0');
          formData.append('format', 'json');
          formData.append('language', 'pt');
          
          // Detectar protocolo da página atual para usar o mesmo protocolo na API
          const currentProtocol = window.location.protocol;
          let endpoint = this.apiEndpoint;
          
          // Garantir que a API use o mesmo protocolo da página
          if (currentProtocol === 'https:' && endpoint.startsWith('http://')) {
            endpoint = endpoint.replace('http://', 'https://');
          } else if (currentProtocol === 'http:' && endpoint.startsWith('https://')) {
            endpoint = endpoint.replace('https://', 'http://');
          }
          
          console.log(`Tentando fetch com endpoint: ${endpoint}`);
          
          // Enviar com fetch
          const response = await fetch(endpoint, {
            method: 'POST',
            body: formData
          });
          
          return await this._processResponse(response);
        } catch (fetchError) {
          console.error('Também falhou com fetch:', fetchError);
          throw fetchError;
        }
      } finally {
        this.transcriptionInProgress = false;
      }
    } catch (error) {
      console.error('Erro ao processar chunks de áudio:', error);
      this._dispatchEvent('transcriptionError', { error: error.message });
    }
  }
  
  /**
   * NOVO: Envia áudio usando XMLHttpRequest (mais robusto para uploads grandes)
   * @param {Blob} audioBlob - O blob de áudio
   * @param {string} fileName - Nome do arquivo
   * @returns {Promise<Object>} - Resultado da transcrição
   * @private
   */
  _sendAudioWithXHR(audioBlob, fileName) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      // Configurar timeout mais longo para arquivos grandes
      xhr.timeout = 30000; // 30 segundos
      
      // Listener para progresso do upload
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          console.log(`Upload progress: ${percent}%`);
        }
      };
      
      // Listeners para eventos
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            console.log('Transcrição recebida via XHR:', response);
            
            // Processar a resposta como uma resposta fetch
            const mockResponse = {
              ok: true,
              json: () => Promise.resolve(response)
            };
            
            // Processar através do método padrão
            this._processResponse(mockResponse)
              .then(result => resolve(result))
              .catch(error => reject(error));
          } catch (parseError) {
            console.error('Erro ao processar resposta XHR:', parseError);
            reject(parseError);
          }
        } else {
          console.error(`Erro XHR: ${xhr.status} - ${xhr.statusText}`);
          reject(new Error(`${xhr.status}: ${xhr.statusText}`));
        }
      };
      
      xhr.onerror = () => {
        console.error('Erro de rede no XHR');
        reject(new Error('Erro de rede na requisição'));
      };
      
      xhr.ontimeout = () => {
        console.error('Timeout no XHR');
        reject(new Error('A requisição excedeu o tempo limite'));
      };
      
      // Detectar protocolo da página para usar o mesmo protocolo na API
      // Isso corrige o erro de Mixed Content no navegador
      const currentProtocol = window.location.protocol;
      let endpoint = this.apiEndpoint;
      
      // Se estamos em HTTPS, garantir que a API também use HTTPS
      if (currentProtocol === 'https:' && endpoint.startsWith('http://')) {
        endpoint = endpoint.replace('http://', 'https://');
      }
      // Se estamos em HTTP, garantir que a API também use HTTP
      else if (currentProtocol === 'http:' && endpoint.startsWith('https://')) {
        endpoint = endpoint.replace('https://', 'http://');
      }
      
      console.log(`Enviando áudio para: ${endpoint} usando protocolo compatível com ${currentProtocol}`);
      
      xhr.open('POST', endpoint, true);
      
      // Preparar FormData
      const formData = new FormData();
      formData.append('file', audioBlob, fileName);
      formData.append('sessionId', 'f275c5c4-fb58-40e3-9710-2c95e30741b0');
      formData.append('chunkCounter', String(this.chunkCounter));
      formData.append('clientTimestamp', new Date().toISOString());
      formData.append('format', 'json');
      formData.append('language', 'pt');
      
      // Enviar
      xhr.send(formData);
    });
  }

  /**
   * Processa a resposta do servidor
   * @param {Response} response - Resposta da requisição
   * @returns {Promise<object>} - Dados processados
   * @private
   */
  async _processResponse(response) {
    try {
      // Verificar se a resposta é válida
      if (!response.ok) {
        let errorText = 'Erro desconhecido';
        try {
          // Tentar obter mensagens de erro detalhadas
          if (response.json) {
            try {
              const errorData = await response.json();
              errorText = errorData.message || errorData.error || response.statusText;
            } catch (e) {
              // Se não conseguir como JSON, tentar como texto
              errorText = await response.text();
            }
          } else if (typeof response.statusText === 'string') {
            errorText = response.statusText;
          }
        } catch (e) {
          errorText = `Erro HTTP ${response.status || 'desconhecido'}`;
        }

        console.error(`Erro na resposta do servidor (${response.status}): ${errorText}`);
        this._dispatchEvent('transcriptionError', { error: errorText });
        throw new Error(`Erro ${response.status}: ${errorText}`);
      }

      // Processar a resposta JSON
      let data;
      
      // Verificar se é um mock de resposta XHR
      if (response.json && typeof response.json === 'function') {
        data = await response.json();
      } else if (response.data) {
        // Se já é um objeto de dados (do XHR)
        data = response.data;
      } else {
        console.error('Formato de resposta desconhecido:', response);
        throw new Error('Formato de resposta inválido');
      }

      // Validar os dados
      if (!data) {
        throw new Error('Resposta vazia do servidor');
      }

      // Verificar formatação da resposta
      const text = data.text || data.transcript || data.content || data.result || (data.data ? data.data.text : null);
      
      if (!text) {
        console.error('Resposta sem texto:', data);
        this._dispatchEvent('transcriptionError', { error: 'Resposta sem texto reconhecível' });
        throw new Error('Resposta sem texto reconhecível');
      }

      console.log('Transcrição recebida:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));

      // Normalizar a resposta
      const normalizedData = {
        text: text,
        format: data.format || 'text',
        duration: data.duration || 0,
        sessionId: data.sessionId || this.sessionId
      };

      // Enviar o evento de transcrição
      this._dispatchEvent('transcription', {
        text: normalizedData.text,
        format: normalizedData.format,
        duration: normalizedData.duration,
        chunkCounter: this.chunkCounter
      });
      
      // Processar a transcrição no contexto do app
      this._processTranscription({ data: normalizedData }, null);

      // Incrementar o contador de chunks
      this.chunkCounter++;

      // Solução: reiniciar completamente a gravação para o próximo chunk
      console.log('SOLUÇÃO: Reiniciando gravação para evitar problemas nos áudios subsequentes');
      
      // Parar a gravação atual se estiver ativa
      if (this.isRecording || this.mediaRecorder) {
        await this.stopRecording(false);
      }
      
      // Liberar completamente todos os recursos
      await this._releaseAllAudioResources();
      
      // Manter o número do chunk para controle de sequência
      // this.chunkCounter = 0;
      
      // Reiniciar gravação após pequeno intervalo
      console.log("Aguardando 2 segundos antes de reiniciar gravação...");
      
      // Usar setTimeout para garantir que haja um atraso antes do reinício
      setTimeout(async () => {
        console.log("Reiniciando gravação automaticamente...");
        try {
          // Forçar a flag autoRestart para true
          this.autoRestart = true;
          
          const result = await this.startRecording();
          console.log(`Resultado do reinício automático: ${result ? 'SUCESSO' : 'FALHA'}`);
          
          if (!result) {
            console.error("Falha no reinício automático, tentando novamente em 3 segundos");
            setTimeout(() => {
              console.log("Tentativa de recuperação após falha no reinício");
              this.startRecording();
            }, 3000);
          }
        } catch (e) {
          console.error("Erro ao reiniciar gravação automaticamente:", e);
          // Tentar novamente após um intervalo maior
          setTimeout(() => {
            console.log("Tentativa de recuperação após ERRO no reinício");
            this.startRecording();
          }, 4000);
        }
      }, 2000);

      return normalizedData;
    } catch (error) {
      console.error('Erro ao processar resposta:', error);
      this._dispatchEvent('transcriptionError', { error: error.message });
      throw error;
    }
  }

  /**
   * Obtém todo o texto transcrito acumulado
   * @returns {string} Texto completo das transcrições
   */
  getFullTranscription() {
    if (!this.transcriptionHistory || this.transcriptionHistory.length === 0) {
      return '';
    }
    
    return this.transcriptionHistory
      .map(entry => entry.text)
      .join('\n');
  }

  /**
   * Despacha um evento padronizado do serviço Whisper
   * @param {string} eventName - Nome do evento
   * @param {Object} data - Dados do evento
   * @private
   */
  _dispatchEvent(eventName, data = {}) {
    // Adicionar timestamp
    const eventData = {
      ...data,
      timestamp: new Date().toISOString()
    };
    
    // Criar eventos em dois formatos para compatibilidade
    const dashedEvent = new CustomEvent(`whisper-${eventName}`, { detail: eventData });
    const colonEvent = new CustomEvent(`whisper:${eventName}`, { detail: eventData });
    
    // Disparar no document e window
    document.dispatchEvent(dashedEvent);
    document.dispatchEvent(colonEvent);
    window.dispatchEvent(dashedEvent);
    window.dispatchEvent(colonEvent);
    
    console.log(`Evento Whisper disparado: ${eventName}`, eventData);
  }

  // Adicionar configuração para controlar o reinício automático
  setAutoRestart(enable) {
    this.autoRestart = enable;
    console.log(`Reinício automático ${enable ? 'ativado' : 'desativado'}`);
  }

  /**
   * Força o reinício da gravação de áudio
   * @returns {Promise<boolean>} - Sucesso do reinício
   */
  async forceRestartRecording() {
    console.log('=== FORÇANDO REINÍCIO COMPLETO DA GRAVAÇÃO ===');
    
    try {
      // 1. Parar qualquer gravação em andamento
      if (this.isRecording || this.mediaRecorder) {
        await this.stopRecording(false);
      }
      
      // 2. Liberar TODOS os recursos
      await this._releaseAllAudioResources();
      
      // 3. Esperar um tempo para garantir a liberação completa
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 4. Resetar contador para garantir que seja tratado como primeiro áudio
      this.chunkCounter = 0;
      console.log('Contador de chunks resetado para 0 - próximo áudio será tratado como primeiro');
      
      // 5. Iniciar nova gravação do zero
      console.log('Iniciando nova gravação forçada');
      const success = await this.startRecording();
      
      console.log(`Reinício forçado ${success ? 'bem-sucedido' : 'falhou'}`);
      return success;
    } catch (error) {
      console.error('Erro ao forçar reinício da gravação:', error);
      
      // Tentar novamente com mais tempo de espera
      try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('Tentando novamente o reinício forçado após erro...');
        return await this.startRecording();
      } catch (retryError) {
        console.error('Falha na segunda tentativa de reinício:', retryError);
        return false;
      }
    }
  }

  /**
   * NOVO: Pausa a gravação por inatividade/silêncio
   * @private
   */
  async _pauseRecordingForSilence() {
    console.log('=== PAUSANDO GRAVAÇÃO POR SILÊNCIO ===');
    
    try {
      // Marcar como pausado por silêncio
      this.pausedForSilence = true;
      
      // Parar a gravação sem processar o áudio (já foi processado)
      await this.stopRecording(false);
      
      // Iniciar detecção de voz para retomar gravação
      this._startVoiceDetection();
      
      console.log('Gravação pausada por silêncio. Aguardando voz para reiniciar...');
    } catch (error) {
      console.error('Erro ao pausar gravação por silêncio:', error);
    }
  }
  
  /**
   * NOVO: Inicia detecção de voz após pausa por silêncio
   * @private
   */
  _startVoiceDetection() {
    // Limpar qualquer intervalo existente
    if (this.voiceDetectionInterval) {
      clearInterval(this.voiceDetectionInterval);
    }
    
    console.log('Iniciando detecção de voz para retomar gravação...');
    
    // Verificar se temos permissão para usar o microfone
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        // Configurar contexto de áudio para analisar volume
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        
        analyser.fftSize = 256;
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Iniciar verificação a cada 300ms
        this.voiceDetectionInterval = setInterval(() => {
          if (!this.pausedForSilence) {
            // Se não estamos mais pausados, limpar recursos
            clearInterval(this.voiceDetectionInterval);
            stream.getTracks().forEach(track => track.stop());
            audioContext.close();
            return;
          }
          
          // Obter dados de volume
          analyser.getByteFrequencyData(dataArray);
          
          // Calcular volume médio
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          
          // Converter para dB
          const volumeDb = 20 * Math.log10(average / 255);
          
          // Se volume for maior que o limiar, detectamos voz
          if (volumeDb > this.voiceThreshold) {
            console.log(`Voz detectada! (${volumeDb.toFixed(1)} dB) - Reiniciando gravação!`);
            
            // Limpar intervalo e recursos
            clearInterval(this.voiceDetectionInterval);
            stream.getTracks().forEach(track => track.stop());
            audioContext.close();
            
            // Reiniciar gravação
            this.pausedForSilence = false;
            this.forceRestartRecording();
          }
        }, 300);
      })
      .catch(err => {
        console.error('Erro ao acessar microfone para detecção de voz:', err);
      });
  }

  /**
   * MODIFICADO: Processar a transcrição recebida
   * @param {Object} response - Resposta da API
   * @param {Blob} audioBlob - Blob de áudio enviado (para debug)
   * @private
   */
  async _processTranscription(response, audioBlob) {
    try {
      // Validar resposta
      if (!response || !response.data) {
        throw new Error('Resposta de transcrição inválida');
      }
      
      const transcription = response.data.text || response.data.transcript || response.data;
      console.log(`Transcrição recebida (${transcription.length} caracteres): ${transcription.substring(0, 100)}...`);
      
      // Validar transcrição
      if (!transcription || transcription.trim().length === 0) {
        console.warn('Transcrição vazia recebida, ignorando...');
        return false;
      }
      
      // Formato para envio para o AI Context
      const transcriptionData = {
        sessionId: this.sessionId || this.extractSessionId(),
        speaker: 'user', // Definimos 'user' como padrão, poderia ser configurável
        content: transcription.trim(),
        timestamp: new Date().toISOString()
      };
      
      // NOVO: Salvar no sessionStorage imediatamente como backup
      this._saveTranscriptionToStorage(transcriptionData);
      
      // CORREÇÃO: Usar nossa nova função para enviar a transcrição para o backend
      await this._sendTranscriptionToBackend(transcriptionData);
      
      // Adicionar ao estado local, útil para manutenção do histórico
      // e para casos em que o app não tem conexão com o backend
      this.transcriptionHistory.push(transcriptionData);
      
      // Disparar evento de nova transcrição
      this._dispatchEvent('transcriptionReceived', {
        transcript: transcription,
        ...transcriptionData
      });
      
      // MELHORIA: Armazenar no localStorage para recuperação posterior
      try {
        const sessionId = transcriptionData.sessionId;
        const key = `whisper_transcript_${sessionId}`;
        
        // Recuperar transcrições existentes
        let existingTranscripts = [];
        const storedData = localStorage.getItem(key);
        if (storedData) {
          try {
            existingTranscripts = JSON.parse(storedData);
          } catch (e) {
            console.warn('Erro ao recuperar transcrições armazenadas:', e);
          }
        }
        
        // Adicionar nova transcrição
        existingTranscripts.push(transcriptionData);
        
        // Salvar no localStorage
        localStorage.setItem(key, JSON.stringify(existingTranscripts));
        console.log('Transcrição salva no localStorage para recuperação futura');
        
        // MELHORIA: Atualizar diretamente o estado do transcript no AIContext
        if (window.__AI_CONTEXT) {
          const currentTranscript = window.__AI_CONTEXT.transcript || '';
          const newTranscript = currentTranscript 
            ? `${currentTranscript}\n${transcriptionData.speaker}: ${transcriptionData.content}`
            : `${transcriptionData.speaker}: ${transcriptionData.content}`;
          
          // Se o AIContext tem uma função para atualizar o transcript, usá-la
          if (typeof window.__AI_CONTEXT.updateTranscript === 'function') {
            window.__AI_CONTEXT.updateTranscript(newTranscript);
            console.log('Transcript atualizado diretamente no AIContext via updateTranscript');
          } else {
            // Caso contrário, disparar um evento para o AIContext atualizar o transcript
            window.dispatchEvent(new CustomEvent('transcript-updated', { 
              detail: { fullText: newTranscript }
            }));
            console.log('Evento transcript-updated disparado para atualizar AIContext');
          }
        }
      } catch (storageError) {
        console.warn('Erro ao salvar transcrição no localStorage:', storageError);
      }
      
      // Tentar encontrar o AI Context e salvar a transcrição
      try {
        // Notificar via evento global que capturamos transcrição
        window.dispatchEvent(new CustomEvent('whisper-transcription', { 
          detail: transcriptionData
        }));
        
        // Tentar usar o AIContext se disponível
        if (window.__AI_CONTEXT && window.__AI_CONTEXT.saveTranscript) {
          console.log('AIContext encontrado, salvando transcrição via contexto...');
          const result = await window.__AI_CONTEXT.saveTranscript(transcriptionData);
          
          // CORREÇÃO: REMOVIDO chamada automática para suggest() para evitar sugestões duplicadas
          // quando HybridAI e Whisper estão sendo usados simultaneamente
          
          // Verificar se existe flag global indicando que o HybridAI está ativo
          const hybridAIActive = window.__HYBRID_AI_ACTIVE || 
                                (window.__AI_CONTEXT && window.__AI_CONTEXT.hybridAIActive);
          
          if (result && result.success && !hybridAIActive) {
            // Apenas disparar um evento para notificar que há nova transcrição
            // sem chamar diretamente o suggest()
            console.log('Transcrição salva com sucesso, notificando via evento');
            
            window.dispatchEvent(new CustomEvent('whisper-transcription-saved', {
              detail: { 
                sessionId: transcriptionData.sessionId,
                length: transcriptionData.content.length
              }
            }));
          }
        }
      } catch (aiContextError) {
        console.error('Erro ao interagir com AIContext:', aiContextError);
      }
      
      return true;
    } catch (error) {
      console.error('Erro ao processar transcrição:', error);
      return false;
    }
  }

  /**
   * Envia uma transcrição para o backend
   * @param {Object} data - Dados da transcrição
   * @returns {Promise<Object>} Resultado do envio
   * @private
   */
  async _sendTranscriptionToBackend(data) {
    try {
      // Obter token de autenticação
      const authToken = localStorage.getItem('authToken') || 
                        sessionStorage.getItem('authToken') || 
                        localStorage.getItem('token') || 
                        sessionStorage.getItem('token');
      
      if (!authToken) {
        console.error('Whisper: Token de autenticação não encontrado para envio de transcrição');
        return { success: false, error: 'Token de autenticação não encontrado' };
      }
      
      // CORREÇÃO: Obter ID de sessão válido do DOM ou localStorage
      // Em vez de usar um ID fixo, tente obter o ID correto da sessão atual
      let sessionId = null;
      
      // 1. Tente obter dos parâmetros da URL primeiro (mais confiável)
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const pathSegments = window.location.pathname.split('/');
        
        // Procurar em parâmetros da URL
        if (urlParams.has('sessionId')) {
          sessionId = urlParams.get('sessionId');
        } 
        // Procurar em segmentos do path (/session/{id})
        else if (pathSegments.includes('session') && pathSegments.length > pathSegments.indexOf('session') + 1) {
          sessionId = pathSegments[pathSegments.indexOf('session') + 1];
        }
        
        // Se não encontrou, procurar ID de formato UUID em qualquer posição do path
        if (!sessionId) {
          const uuidMatch = window.location.pathname.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
          if (uuidMatch) {
            sessionId = uuidMatch[0];
          }
        }
      } catch (urlError) {
        console.warn('Erro ao extrair sessionId da URL:', urlError);
      }
      
      // 2. Se não encontrou na URL, tente obter do localStorage ou sessionStorage
      if (!sessionId) {
        sessionId = localStorage.getItem('currentSessionId') || 
                    sessionStorage.getItem('currentSessionId') ||
                    localStorage.getItem('sessionId') ||
                    sessionStorage.getItem('sessionId');
      }
      
      // 3. Se ainda não encontrou, procurar por qualquer elemento na página com data-session-id
      if (!sessionId) {
        const sessionElement = document.querySelector('[data-session-id]');
        if (sessionElement) {
          sessionId = sessionElement.getAttribute('data-session-id');
        }
      }
      
      // 4. Se ainda não encontrou, procurar variável global __AI_CONTEXT
      if (!sessionId && window.__AI_CONTEXT && window.__AI_CONTEXT.sessionId) {
        sessionId = window.__AI_CONTEXT.sessionId;
      }
      
      // 5. Se ainda não encontrou, tente usar o ID que veio no parâmetro da função
      if (!sessionId && data.sessionId) {
        sessionId = data.sessionId;
      }
      
      // 6. Se ainda não tem ID, usar um ID fixo como último recurso
      if (!sessionId) {
        // HACK: Usar um ID que possui alta probabilidade de existir
        // Isso é um fallback para evitar erros 404
        sessionId = 'temp_session';
      }
      
      console.log(`Whisper: Usando sessionId: ${sessionId}`);
      
      // Usar o ID de sessão encontrado
      data.sessionId = sessionId;
      
      // CORREÇÃO: Garantir que temos o speaker (padrão 'user')
      if (!data.speaker) {
        data.speaker = 'user';
      }
      
      // CORREÇÃO: Garantir que temos o conteúdo na propriedade correta
      if (data.transcript && !data.content) {
        data.content = data.transcript;
      } else if (!data.content && data.text) {
        data.content = data.text;
      }
      
      // CORREÇÃO: Garantir que transcript também existe (propriedade exigida pelo endpoint /api/ai/transcript)
      if (!data.transcript && data.content) {
        data.transcript = data.content;
      }
      
      console.log('Whisper: Enviando transcrição para backend:', {
        sessionId: data.sessionId,
        speaker: data.speaker,
        contentLength: data.content?.length || 0,
        endpoint: this.transcriptEndpoint
      });
      
      // CORREÇÃO: Construir payload apropriado para cada endpoint
      const transcriptionsPayload = {
        sessionId: sessionId,
        speaker: data.speaker,
        content: data.content,
        timestamp: data.timestamp || new Date().toISOString()
      };
      
      const transcriptPayload = {
        sessionId: sessionId,
        transcript: data.content || data.transcript,
        speaker: data.speaker
      };
      
      // Tenta o endpoint principal (transcriptions) primeiro
      try {
        const response = await fetch(this.transcriptEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify(transcriptPayload)
        });
        
        if (response.ok) {
          console.log(`Whisper: Transcrição enviada com sucesso para: ${this.transcriptEndpoint}`);
          return { success: true };
        } else {
          const errorText = await response.text();
          console.warn(`Whisper: Erro ao enviar para ${this.transcriptEndpoint} (${response.status}): ${errorText}`);
          
          // Se o erro foi 404 (endpoint não existe), tentar com caminho alternativo
          if (response.status === 404) {
            // Tentar endpoint alternativo com caminho diferente
            const alternativeEndpoint = this.transcriptEndpoint.replace('/api/ai/transcript', '/api/transcript');
            
            const altResponse = await fetch(alternativeEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
              },
              body: JSON.stringify(transcriptPayload)
            });
            
            if (altResponse.ok) {
              console.log(`Whisper: Transcrição enviada com sucesso para endpoint alternativo: ${alternativeEndpoint}`);
              return { success: true };
            }
          }
        }
      } catch (primaryError) {
        console.warn(`Whisper: Erro ao enviar para endpoint primário:`, primaryError);
      }
      
      // Se falhou com o endpoint principal, salvar localmente
      // Isso garante que pelo menos temos os dados no cliente
      this._saveTranscriptionToStorage(transcriptionsPayload);
      
      // Continuar operação normal mesmo em caso de falha do backend
      // Não devemos interromper a experiência do usuário
      return { 
        success: false, 
        error: 'Falha ao enviar transcrição para o backend, mas dados foram salvos localmente'
      };
    } catch (error) {
      console.error('Whisper: Erro ao enviar transcrição:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * NOVO: Salvar transcrição no sessionStorage como backup
   * @param {Object} transcription - A transcrição a ser salva
   * @private
   */
  _saveTranscriptionToStorage(transcription) {
    try {
      if (!transcription || !transcription.sessionId || !transcription.content) {
        return false;
      }
      
      // Usar sessionStorage para maior segurança
      const key = `whisper_transcriptions_${transcription.sessionId}`;
      
      // Obter transcrições existentes
      let transcriptions = [];
      const stored = sessionStorage.getItem(key);
      
      if (stored) {
        try {
          transcriptions = JSON.parse(stored);
          if (!Array.isArray(transcriptions)) {
            transcriptions = [];
          }
        } catch (e) {
          console.warn('Erro ao recuperar transcrições armazenadas:', e);
          transcriptions = [];
        }
      }
      
      // Adicionar nova transcrição
      transcriptions.push({
        ...transcription,
        clientTimestamp: Date.now()
      });
      
      // Salvar de volta
      sessionStorage.setItem(key, JSON.stringify(transcriptions));
      console.log(`Transcrição salva no sessionStorage: ${key}, total: ${transcriptions.length}`);
      
      // Também salvar a última transcrição separadamente
      sessionStorage.setItem(`last_transcript_${transcription.sessionId}`, JSON.stringify(transcription));
      
      return true;
    } catch (e) {
      console.warn('Erro ao salvar transcrição no sessionStorage:', e);
      return false;
    }
  }

  /**
   * Atualiza o ID da sessão atual
   * @param {string} sessionId - ID da sessão
   */
  updateSessionId(sessionId) {
    if (!sessionId) {
      console.error('Tentativa de atualizar sessionId com valor inválido:', sessionId);
      return;
    }
    
    console.log(`Atualizando ID da sessão para: ${sessionId}`);
    this.sessionId = sessionId;
  }
}

// Exportar como singleton
const whisperTranscriptionService = new WhisperTranscriptionService();
export default whisperTranscriptionService;