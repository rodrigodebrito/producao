/**
 * WhisperTranscriptionService
 * Serviço para gravar áudio, converter formatos e enviar para a API Whisper
 * Com detecção automática de silêncio e envio de chunks
 */
import { WHISPER_URL, API_URL } from '../config';

class WhisperTranscriptionService {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.audioStream = null;
    this.isRecording = false;
    
    // Usar a URL configurada na configuração global para garantir consistência
    this.apiEndpoint = WHISPER_URL;
    this.transcriptEndpoint = `${API_URL}/ai/transcript`;
    
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
    
    // Configurações para detecção de silêncio
    this.silenceDetectionEnabled = true;
    this.silenceThreshold = -45; // dB (mais negativo = mais sensível)
    this.silenceDuration = 5000; // AJUSTADO: 5 segundos de silêncio para enviar e parar
    this.maxChunkDuration = 15000; // AJUSTADO: 15 segundos máximos por chunk (mais rápido)
    this.minChunkDuration = 1500; // AJUSTADO: 1.5 segundos mínimos por chunk
    
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
    this.sessionId = null;
    
    // Contador de chunks
    this.chunkCounter = 0;

    // Adicionar configuração para controlar o reinício automático
    this.autoRestart = true; // AJUSTADO: Sempre reiniciar por padrão
    
    // NOVO: Flag para verificar se estamos em pausa por silêncio
    this.pausedForSilence = false;
    
    // NOVO: Configuração para detecção de voz após pausa
    this.voiceDetectionEnabled = true;
    this.voiceThreshold = -40; // dB (menos sensível que o silêncio)
    this.voiceDetectionInterval = null;
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
   * Iniciar a gravação de áudio e configurar detecção de silêncio
   * @returns {Promise<boolean>} - Sucesso da inicialização da gravação
   */
  async startRecording() {
    try {
      console.log('=== INICIANDO NOVA GRAVAÇÃO WAV ===');
      
      // ESTRATÉGIA ANTI-CORRUPÇÃO: Forçar liberação máxima entre gravações
      
      // 1. Forçar parada de qualquer gravação existente
      if (this.isRecording || this.mediaRecorder) {
        console.log('Gravação anterior detectada, parando completamente...');
        await this.stopRecording(false);
        
        // Aguardar liberação de recursos pelo SO
        console.log('Aguardando 800ms para garantir liberação de recursos...');
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      // 2. Liberação COMPLETA de todos os recursos
      await this._releaseAllAudioResources();
      
      // 3. Pausa extra para garantir que o sistema operacional libere handles de arquivos
      console.log('Pausa adicional para garantir liberação total...');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 4. Reiniciar completamente o estado
      this.audioChunks = [];
      this.chunkCounter = 0;
      this.isRecording = true;
      this.chunkStartTime = Date.now();
      
      // 5. Extrair sessionId se necessário
      if (!this.sessionId) {
        this.sessionId = this.extractSessionId();
        console.log(`SessionID extraído: ${this.sessionId}`);
      }
      
      console.log('Solicitando nova permissão de microfone...');
      this.audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      console.log('Permissão de microfone concedida, criando novo MediaRecorder');
      
      // 6. Priorizar WAV como formato para compatibilidade com Whisper
      let mimeType = null;
      
      // Verificar suporte a WAV (prioridade para Whisper API)
      if (MediaRecorder.isTypeSupported('audio/wav')) {
        mimeType = 'audio/wav';
      } else if (MediaRecorder.isTypeSupported('audio/mp3')) {
        mimeType = 'audio/mp3'; 
      } else if (MediaRecorder.isTypeSupported('audio/mpeg')) {
        mimeType = 'audio/mpeg';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      }
      
      console.log(`Formato de gravação selecionado: ${mimeType || 'padrão do navegador'}`);
      
      // 7. Configurar opções avançadas para MediaRecorder
      const options = mimeType ? {
        mimeType,
        audioBitsPerSecond: 128000 // Qualidade mais baixa para evitar problemas
      } : undefined;
      
      // 8. Criar nova instância do MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.audioStream, options);
      
      // 9. Configurar evento para chunks pequenos e frequentes
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          const chunkNum = this.audioChunks.length;
          const sizeKB = Math.round(event.data.size/1024);
          console.log(`Chunk #${chunkNum} recebido: ${sizeKB}KB, tipo: ${event.data.type}`);
          this.audioChunks.push(event.data);
        }
      };
      
      // 10. Capturar erros do MediaRecorder
      this.mediaRecorder.onerror = (event) => {
        console.error('Erro no MediaRecorder:', event);
        this._dispatchEvent('recordingError', { error: 'Erro na gravação de áudio' });
      };
      
      // 11. Iniciar gravação com chunks MUITO pequenos para melhor controle
      this.mediaRecorder.start(300); // 300ms por chunk para maior controle
      console.log('Gravação WAV iniciada com nova instância de MediaRecorder');
      
      // 12. Configurar detecção de silêncio
      if (this.silenceDetectionEnabled) {
        this._setupSilenceDetection(this.audioStream);
      }
      
      // 13. Configurar timer para chunk máximo
      this._setupMaxChunkTimer();
      
      // 14. Disparar evento de início
      this._dispatchEvent('recordingStarted', { isRecording: true });
      
      return true;
    } catch (error) {
      console.error('Erro ao iniciar gravação de áudio:', error);
      this._dispatchEvent('recordingError', { error: error.message });
      return false;
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
        
        // Processar o chunk atual
        this._processCurrentChunk();
        
        // NOVO: Pausar gravação por inatividade
        this._pauseRecordingForSilence();
        
        return; // Não continuar a detecção
      }
    } else {
      // Resetar detecção de silêncio
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
      const mimeType = isFirstAudio ? 'audio/wav' : 'audio/mpeg';
      const extension = isFirstAudio ? '.wav' : '.mp3';
      
      console.log(`Estratégia: Enviando áudio #${this.chunkCounter} como ${isFirstAudio ? 'WAV' : 'MP3'}`);
      
      // 4. Garantir que o nome de arquivo tenha a extensão correta
      let finalFileName = fileName;
      if (!finalFileName.toLowerCase().endsWith(extension)) {
        // Extrair nome base sem extensão
        const baseFileName = fileName.split('.')[0];
        finalFileName = `${baseFileName}${extension}`;
      }
      
      // 5. Criar um novo blob garantindo tipo correto
      const blobToSend = new Blob([audioBlob], { type: mimeType });
      
      console.log(`Enviando áudio como ${isFirstAudio ? 'WAV' : 'MP3'}: ${finalFileName}, tamanho: ${Math.round(blobToSend.size/1024)}KB`);
      
      // 6. Adicionar identificador único e contagem no nome do arquivo para debug
      finalFileName = `audio-${this.chunkCounter}-${Date.now()}-${Math.floor(Math.random() * 10000)}${extension}`;
      
      // 7. Preparar o FormData para envio
      const formData = new FormData();
      formData.append('file', blobToSend, finalFileName);
      
      // 8. Adicionar campos extras para debug do backend
      if (this.sessionId) {
        formData.append('sessionId', this.sessionId);
      }
      formData.append('chunkCounter', String(this.chunkCounter));
      formData.append('isFirstChunk', String(isFirstAudio));
      formData.append('clientTimestamp', new Date().toISOString());
      
      // 9. Disparar evento de processamento
      this._dispatchEvent('processingAudio', {
        fileName: finalFileName,
        size: blobToSend.size,
        format: mimeType,
        isFirstChunk: isFirstAudio,
        chunkCounter: this.chunkCounter,
        duration: Math.round((Date.now() - this.chunkStartTime) / 1000)
      });
      
      // 10. Verificar se já existe transcrição em andamento
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
      
      // 11. Enviar para o backend
      try {
        this.transcriptionInProgress = true;
        
        console.log(`Enviando áudio para o backend: ${this.apiEndpoint}, formato: ${mimeType}, arquivo: ${finalFileName}`);
        
        const response = await fetch(this.apiEndpoint, {
          method: 'POST',
          body: formData
        });
        
        return await this._processResponse(response);
        
      } catch (error) {
        console.error('Erro ao enviar áudio para transcrição:', error);
        this._dispatchEvent('transcriptionError', { error: error.message });
        throw error;
      } finally {
        this.transcriptionInProgress = false;
      }
    } catch (error) {
      console.error('Erro ao processar chunks de áudio:', error);
      this._dispatchEvent('transcriptionError', { error: error.message });
    }
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
          const errorData = await response.json();
          errorText = errorData.message || errorData.error || response.statusText;
        } catch (e) {
          errorText = response.statusText;
        }

        console.error(`Erro na resposta do servidor (${response.status}): ${errorText}`);
        this._dispatchEvent('transcriptionError', { error: errorText });
        throw new Error(`Erro ${response.status}: ${errorText}`);
      }

      // Processar a resposta JSON
      const data = await response.json();

      if (!data.text) {
        console.error('Resposta sem texto:', data);
        this._dispatchEvent('transcriptionError', { error: 'Resposta sem texto' });
        throw new Error('Resposta sem texto');
      }

      console.log('Transcrição recebida:', data.text.substring(0, 100) + (data.text.length > 100 ? '...' : ''));

      // Enviar o evento de transcrição
      this._dispatchEvent('transcription', {
        text: data.text,
        format: data.format,
        duration: data.duration,
        chunkCounter: this.chunkCounter
      });

      // Incrementar o contador de chunks
      this.chunkCounter++;

      // SOLUÇÃO RADICAL: Reiniciar completamente a gravação
      console.log('SOLUÇÃO: Reiniciando gravação para evitar problemas nos áudios subsequentes');
      
      // Parar a gravação atual se estiver ativa
      if (this.isRecording || this.mediaRecorder) {
        await this.stopRecording(false);
      }
      
      // Liberar completamente todos os recursos
      await this._releaseAllAudioResources();
      
      // Resetar o contador para que todos sejam tratados como "primeiro áudio"
      this.chunkCounter = 0;
      console.log("Contador de chunks resetado para 0 - próximo áudio será tratado como primeiro");
      
      // Reiniciar gravação SEMPRE, independente da flag autoRestart
      console.log("FORÇANDO REINÍCIO DA GRAVAÇÃO em 2 segundos...");
      
      // Usar setTimeout para garantir que haja um atraso antes do reinício
      setTimeout(async () => {
        console.log("!!! INICIANDO NOVA GRAVAÇÃO AUTOMATICAMENTE, INDEPENDENTE DE FLAGS !!!");
        try {
          // Forçar a flag autoRestart para true novamente (pode ter sido perdida)
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

      return data;
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
      
      // Tentar encontrar o AI Context e salvar a transcrição
      try {
        // Notificar via evento global que capturamos transcrição
        window.dispatchEvent(new CustomEvent('whisper-transcription', { 
          detail: transcriptionData
        }));
        
        // Tentar usar o AIContext se disponível
        if (window.__AI_CONTEXT && window.__AI_CONTEXT.saveTranscript) {
          console.log('AIContext encontrado, salvando transcrição via contexto...');
          await window.__AI_CONTEXT.saveTranscript(transcriptionData);
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
      
      // CORREÇÃO: Garantir que temos sessionId e formatação correta dos dados
      if (!data.sessionId) {
        data.sessionId = this.sessionId || this.extractSessionId();
      }
      
      // CORREÇÃO: Garantir que temos o speaker (padrão 'user')
      if (!data.speaker) {
        data.speaker = 'user';
      }
      
      // CORREÇÃO: Garantir que temos o conteúdo na propriedade correta
      if (data.transcript && !data.content) {
        data.content = data.transcript;
      }
      
      console.log('Whisper: Enviando transcrição para backend:', {
        sessionId: data.sessionId,
        speaker: data.speaker,
        contentLength: data.content?.length || 0
      });
      
      // CORREÇÃO: Tentar enviar para múltiplos possíveis endpoints
      const endpoints = [
        '/api/ai/transcriptions',
        '/api/ai/transcript',
        'https://theraconnect-prd.onrender.com/api/ai/transcriptions',
        'https://theraconnect-prd.onrender.com/api/ai/transcript'
      ];
      
      // Tentar cada endpoint até conseguir
      let success = false;
      let response = null;
      let error = null;
      
      for (const endpoint of endpoints) {
        try {
          console.log(`Whisper: Tentando enviar para endpoint: ${endpoint}`);
          
          response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(data)
          });
          
          if (response.ok) {
            success = true;
            console.log(`Whisper: Transcrição enviada com sucesso para: ${endpoint}`);
            break;
          } else {
            const errorText = await response.text();
            console.warn(`Whisper: Erro ao enviar para ${endpoint} (${response.status}): ${errorText}`);
          }
        } catch (endpointError) {
          console.warn(`Whisper: Erro de conexão com ${endpoint}:`, endpointError);
          error = endpointError;
        }
      }
      
      // Se conseguimos sucesso em algum endpoint
      if (success) {
        try {
          const result = await response.json();
          console.log('Whisper: Resposta do backend:', result);
          return { success: true, data: result };
        } catch (jsonError) {
          // Se a resposta não for JSON, consideramos sucesso mesmo assim
          console.log('Whisper: Resposta não é JSON, mas transcrição foi enviada');
          return { success: true };
        }
      }
      
      // Se chegamos aqui, nenhum endpoint funcionou
      console.error('Whisper: Todos os endpoints falharam ao enviar transcrição');
      return { 
        success: false, 
        error: error?.message || 'Falha ao enviar transcrição para todos os endpoints'
      };
    } catch (error) {
      console.error('Whisper: Erro ao enviar transcrição:', error);
      return { success: false, error: error.message };
    }
  }
}

// Exportar como singleton
const whisperTranscriptionService = new WhisperTranscriptionService();
export default whisperTranscriptionService;