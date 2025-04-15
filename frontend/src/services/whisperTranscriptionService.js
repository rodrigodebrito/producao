/**
 * WhisperTranscriptionService
 * Servi├ºo para gravar ├íudio, converter formatos e enviar para a API Whisper
 * Com detec├º├úo autom├ítica de sil├¬ncio e envio de chunks
 */
import { WHISPER_URL, API_URL } from '../config';

class WhisperTranscriptionService {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.audioStream = null;
    this.isRecording = false;
    
    // Determinar se estamos em produ├º├úo ou desenvolvimento
    this.isProd = !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');
    const backendBaseUrl = this.isProd ? 'https://theraconnect-prd.onrender.com' : '';
    
    // ATUALIZADO: Usar URLs absolutas em produ├º├úo para todos os endpoints
    this.apiEndpoint = this.isProd ? `${backendBaseUrl}/api/ai/whisper/transcribe` : '/api/ai/whisper/transcribe';
    this.transcriptEndpoint = 'https://theraconnect-prd.onrender.com/api/ai/transcript'; // Manter URL absoluta conforme solicitado
    this.allTranscriptsEndpoint = this.isProd ? `${backendBaseUrl}/api/ai/transcriptions/session` : '/api/ai/transcriptions/session';
    
    // FIXADO: Flag para controlar se o servi├ºo j├í foi inicializado
    this.serviceInitialized = false;
    
    console.log(`Whisper: Servi├ºo criado em ambiente ${this.isProd ? 'de produ├º├úo' : 'de desenvolvimento'}`);
    console.log(`Whisper: Endpoints configurados, aguardando inicializa├º├úo manual`);
    
    this.transcriptionInProgress = false;
    this.useCredentials = false; // Por padr├úo, N├âO enviar credenciais para testes
    this.supportedMimeTypes = [
      'audio/wav', 
      'audio/mp3', 
      'audio/mpeg', 
      'audio/mp4', 
      'audio/webm', 
      'audio/ogg'
    ];
    this.currentFileName = null;
    
    // Configura├º├Áes para detec├º├úo de sil├¬ncio
    this.silenceDetectionEnabled = true;
    this.silenceThreshold = -45; // dB (mais negativo = mais sens├¡vel)
    this.silenceDuration = 5000; // AJUSTADO: 5 segundos de sil├¬ncio para enviar e parar
    this.maxChunkDuration = 15000; // AJUSTADO: 15 segundos m├íximos por chunk (mais r├ípido)
    this.minChunkDuration = 1500; // AJUSTADO: 1.5 segundos m├¡nimos por chunk
    
    // Estado de detec├º├úo de sil├¬ncio
    this.audioContext = null;
    this.audioAnalyser = null;
    this.silenceDetector = null;
    this.silenceStart = null;
    this.silenceTimer = null;
    this.chunkStartTime = null;
    this.maxChunkTimer = null;
    
    // Estado de transcri├º├úo cont├¡nua
    this.transcriptionHistory = [];
    
    // NOVO: Armazenamento de transcri├º├Áes de outros participantes
    this.otherParticipantsTranscriptions = [];
    this.lastFetchTimestamp = null;
    this.transcriptionFetchInterval = null;
    
    // Extrair sessionId ao inicializar, mas n├úo iniciar processamento autom├ítico
    this.sessionId = this.extractSessionId();
    this.speakerRole = this._determineSpeakerRole();
    
    // NOVO: Determinar status de host e identificador completo
    this.isHost = this._isSessionHost();
    this.speakerIdentifier = this._getSpeakerIdentifier();
    
    // NOVO: Controle de sess├úo e transcri├º├Áes
    this.sessionStartTime = Date.now();
    this.lastActivityTime = Date.now();
    this.sessionLogicalId = `${this.sessionId}_${this.sessionStartTime}`;
    
    // Contador de chunks
    this.chunkCounter = 0;

    // Adicionar configura├º├úo para controlar o rein├¡cio autom├ítico
    this.autoRestart = true; // AJUSTADO: Sempre reiniciar por padr├úo
    
    // NOVO: Flag para verificar se estamos em pausa por sil├¬ncio
    this.pausedForSilence = false;
    
    // NOVO: Flag para marcar se a parada foi manual (solicitada pelo usu├írio)
    this.manualStopped = false;
    
    // NOVO: Configura├º├úo para detec├º├úo de voz ap├│s pausa
    this.voiceDetectionEnabled = true;
    this.voiceThreshold = -40; // dB (menos sens├¡vel que o sil├¬ncio)
    this.voiceDetectionInterval = null;
    
    // Verificar transcri├º├Áes antigas e limpar se necess├írio
    this._cleanStaleTranscriptions();
    
    // Adicionar event listener para limpar dados ao entrar em nova sess├úo
    this._setupSessionChangeDetection();
    
    // N├âO iniciar busca de transcri├º├Áes automaticamente
    // Ser├í iniciado quando o usu├írio come├ºar a grava├º├úo
    
    console.log(`WhisperTranscriptionService constru├¡do - sessionId: ${this.sessionId}, papel: ${this.speakerIdentifier}, host: ${this.isHost}`);
  }
  
  /**
   * NOVO: M├®todo p├║blico para inicializar completamente o servi├ºo
   * Deve ser chamado quando o usu├írio entrar na sala
   */
  initializeService() {
    if (this.serviceInitialized) {
      console.log('Whisper: Servi├ºo j├í inicializado anteriormente');
      return;
    }
    
    // Atualizar sessionId com o valor mais recente
    const latestSessionId = this.extractSessionId();
    if (latestSessionId !== this.sessionId) {
      this.updateSessionId(latestSessionId);
    }
    
    // Iniciar busca de transcri├º├Áes de outros participantes
    this._startFetchingOtherTranscriptions();
    
    this.serviceInitialized = true;
    console.log(`Whisper: Servi├ºo inicializado completamente - sessionId: ${this.sessionId}`);
  }
  
  /**
   * NOVO: M├®todo p├║blico que combina inicializa├º├úo e in├¡cio de grava├º├úo
   * Para ser chamado quando o usu├írio clicar no bot├úo do microfone
   */
  async startRecordingSession() {
    // Inicializar o servi├ºo se ainda n├úo foi feito
    if (!this.serviceInitialized) {
      this.initializeService();
    }
    
    // Iniciar grava├º├úo
    return await this.startRecording();
  }
  
  /**
   * NOVO: Configurar detec├º├úo de mudan├ºa de sess├úo
   * @private
   */
  _setupSessionChangeDetection() {
    // Detectar quando a p├ígina se torna vis├¡vel (retorno ap├│s tab ou minimiza├º├úo)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const currentSessionId = this.extractSessionId();
        
        // Se o ID da sess├úo mudou enquanto a p├ígina estava invis├¡vel
        if (currentSessionId !== this.sessionId && currentSessionId) {
          console.log(`Whisper: Detectada mudan├ºa de sess├úo de ${this.sessionId} para ${currentSessionId}`);
          this.updateSessionId(currentSessionId);
          this._clearPreviousTranscriptions();
        }
        
        // Verificar se a sess├úo est├í inativa h├í muito tempo
        const inactiveTime = Date.now() - this.lastActivityTime;
        if (inactiveTime > 30 * 60 * 1000) { // 30 minutos
          console.log(`Whisper: Sess├úo inativa por ${Math.round(inactiveTime/60000)} minutos, limpando transcri├º├Áes`);
          this._clearPreviousTranscriptions();
        }
        
        // Atualizar timestamp de atividade
        this.lastActivityTime = Date.now();
      }
    });
    
    // Detectar carregamento inicial da p├ígina
    window.addEventListener('load', () => {
      // Ao carregar a p├ígina, limpar transcri├º├Áes antigas
      console.log('Whisper: P├ígina carregada, limpando transcri├º├Áes antigas');
      this._clearPreviousTranscriptions();
    });
    
    // Ouvir eventos espec├¡ficos de inicializa├º├úo de sess├úo do sistema
    window.addEventListener('session-started', (e) => {
      console.log('Whisper: Evento session-started recebido');
      this._clearPreviousTranscriptions();
      
      // Se o evento tiver um ID de sess├úo, us├í-lo
      if (e.detail && e.detail.sessionId) {
        this.updateSessionId(e.detail.sessionId);
      }
    });
  }
  
  /**
   * NOVO: Limpa transcri├º├Áes antigas no storage
   * @private
   */
  _cleanStaleTranscriptions() {
    console.log('Whisper: Verificando transcri├º├Áes antigas...');
    
    try {
      const now = Date.now();
      const maxAge = 12 * 60 * 60 * 1000; // 12 horas
      const keysToCheck = [];
      
      // Coletar todas as chaves de transcri├º├úo no localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('whisper_transcript_')) {
          keysToCheck.push(key);
        }
      }
      
      // Verificar cada chave para determinar sua idade
      let removedCount = 0;
      
      for (const key of keysToCheck) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          
          if (Array.isArray(data) && data.length > 0) {
            const lastItem = data[data.length - 1];
            
            // Verificar se temos um timestamp para determinar a idade
            if (lastItem && lastItem.timestamp) {
              const timestamp = new Date(lastItem.timestamp).getTime();
              const age = now - timestamp;
              
              if (age > maxAge) {
                localStorage.removeItem(key);
                sessionStorage.removeItem(key);
                removedCount++;
                console.log(`Whisper: Removida transcri├º├úo antiga (${Math.round(age/3600000)}h): ${key}`);
              }
            }
          }
        } catch (e) {
          console.warn(`Whisper: Erro ao verificar idade de ${key}:`, e);
          // Remover entradas com erro de parsing
          localStorage.removeItem(key);
          sessionStorage.removeItem(key);
          removedCount++;
        }
      }
      
      console.log(`Whisper: Verifica├º├úo conclu├¡da. Removidas ${removedCount} transcri├º├Áes antigas.`);
    } catch (e) {
      console.error('Whisper: Erro ao limpar transcri├º├Áes antigas:', e);
    }
  }

  /**
   * Determina o papel do usu├írio (terapeuta ou cliente) com base na sess├úo atual
   * @returns {string} 'therapist' ou 'client'
   * @private
   */
  _determineSpeakerRole() {
    try {
      // Verificar se existe informa├º├úo de usu├írio local
      const userData = localStorage.getItem('user') || sessionStorage.getItem('user');
      
      if (userData) {
        try {
          const user = JSON.parse(userData);
          
          // Se temos informa├º├úo de role, usar diretamente
          if (user && user.role) {
            if (user.role === 'THERAPIST') return 'therapist';
            if (user.role === 'CLIENT') return 'client';
          }
          
          // Se temos informa├º├Áes como isTherapist ou tipo de usu├írio
          if (user && (user.isTherapist || user.userType === 'THERAPIST')) {
            return 'therapist';
          }
        } catch (e) {
          console.warn('Whisper: Erro ao parse de userData para determinar papel:', e);
        }
      }
      
      // Segundo m├®todo: verificar URL por indicadores de terapeuta/cliente
      const url = window.location.href.toLowerCase();
      if (url.includes('therapist') || url.includes('terapeuta')) {
        return 'therapist';
      }
      if (url.includes('client') || url.includes('cliente')) {
        return 'client';
      }
      
      // Fallback: assumir cliente
      return 'client';
    } catch (e) {
      console.error('Whisper: Erro ao determinar papel do usu├írio:', e);
      return 'unknown';
    }
  }

  /**
   * NOVO: Verifica se o usu├írio atual ├® o host (anfitri├úo/dono) da sess├úo
   * Isso ├® ├║til para diferenciar quando dois terapeutas est├úo em uma sess├úo
   * @returns {boolean} True se o usu├írio atual ├® o host da sess├úo
   * @private
   */
  _isSessionHost() {
    try {
      // 1. Verificar no AIContext se temos informa├º├úo de host
      if (window.__AI_CONTEXT && typeof window.__AI_CONTEXT.isHost === 'boolean') {
        return window.__AI_CONTEXT.isHost;
      }
      
      // 2. Verificar se temos informa├º├úo de sess├úo no sessionStorage
      const sessionData = sessionStorage.getItem(`session_${this.sessionId}`);
      if (sessionData) {
        try {
          const session = JSON.parse(sessionData);
          if (session && typeof session.isHost === 'boolean') {
            return session.isHost;
          }
          
          // Verificar se o usu├írio atual ├® o criador da sess├úo
          if (session && session.ownerId) {
            const userData = localStorage.getItem('user') || sessionStorage.getItem('user');
            if (userData) {
              const user = JSON.parse(userData);
              if (user && user.id && user.id === session.ownerId) {
                return true;
              }
            }
          }
        } catch (e) {
          console.warn('Whisper: Erro ao analisar dados da sess├úo para determinar host:', e);
        }
      }
      
      // 3. Verificar se existe um elemento DOM com data-is-host
      const hostElement = document.querySelector('[data-is-host]');
      if (hostElement) {
        const isHostAttr = hostElement.getAttribute('data-is-host');
        if (isHostAttr === 'true') return true;
        if (isHostAttr === 'false') return false;
      }
      
      // 4. Para terapeutas: assumir que s├úo host por padr├úo
      if (this.speakerRole === 'therapist') {
        console.log('Whisper: Usu├írio ├® terapeuta, assumindo que ├® host por padr├úo');
        return true;
      }
      
      // 5. Para clientes: assumir que n├úo s├úo host por padr├úo
      if (this.speakerRole === 'client') {
        return false;
      }
      
      // Fallback: se n├úo conseguimos determinar, assumir false
      return false;
    } catch (e) {
      console.error('Whisper: Erro ao determinar status de host:', e);
      return false;
    }
  }
  
  /**
   * NOVO: Determina o identificador do papel com base no papel do usu├írio e status de host
   * ├Ütil para quando dois terapeutas est├úo na mesma sess├úo
   * @returns {string} Identificador do papel (therapist_host, therapist_guest, client)
   * @private
   */
  _getSpeakerIdentifier() {
    const role = this.speakerRole;
    const isHost = this._isSessionHost();
    
    // Caso especial: dois terapeutas na mesma sess├úo
    if (role === 'therapist') {
      return isHost ? 'therapist_host' : 'therapist_guest';
    }
    
    // Para clientes, manter identifica├º├úo simples
    return role;
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
      
      // 1. Verificar padr├úo /session/{id} (padr├úo principal)
      const sessionMatch = url.match(/\/session\/([a-zA-Z0-9_-]+)/);
      if (sessionMatch && sessionMatch[1]) {
        console.log('Whisper: SessionId extra├¡do da URL (padr├úo /session/):', sessionMatch[1]);
        return sessionMatch[1];
      }
      
      // 2. Verificar padr├úo de UUID/GUID na URL
      const uuidMatch = url.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
      if (uuidMatch && uuidMatch[0]) {
        console.log('Whisper: SessionId extra├¡do da URL (formato UUID):', uuidMatch[0]);
        return uuidMatch[0];
      }
      
      // 3. Obter do localStorage ou sessionStorage
      const savedSessionId = localStorage.getItem('currentSessionId') || sessionStorage.getItem('currentSessionId');
      if (savedSessionId) {
        console.log('Whisper: SessionId obtido do storage:', savedSessionId);
        return savedSessionId;
      }
      
      // 4. Gerar ID tempor├írio com mais informa├º├úo
      const tempId = `temp_${Date.now()}`;
      console.log('Whisper: Usando ID tempor├írio:', tempId);
      return tempId;
    } catch (e) {
      console.error('Whisper: Erro ao extrair sessionId:', e);
      return `error_${Date.now()}`;
    }
  }
  
  /**
   * Atualiza o ID da sess├úo atual
   * @param {string} newSessionId - Novo ID de sess├úo
   */
  updateSessionId(newSessionId) {
    if (!newSessionId) return;
    
    // Se o ID est├í mudando, limpar as transcri├º├Áes antigas
    if (this.sessionId && this.sessionId !== newSessionId) {
      this._clearPreviousTranscriptions();
    }
    
    console.log(`Whisper: Atualizando sessionId de "${this.sessionId}" para "${newSessionId}"`);
    this.sessionId = newSessionId;
    
    // Atualizar informa├º├Áes de sess├úo
    this.sessionStartTime = Date.now();
    this.lastActivityTime = Date.now();
    this.sessionLogicalId = `${this.sessionId}_${this.sessionStartTime}`;
    
    // Salvar tamb├®m no storage para consist├¬ncia
    try {
      localStorage.setItem('currentSessionId', newSessionId);
      sessionStorage.setItem('currentSessionId', newSessionId); 
    } catch (e) {
      console.warn('Erro ao salvar sessionId no storage:', e);
    }
  }
  
  /**
   * NOVO: M├®todo p├║blico para limpar manualmente as transcri├º├Áes
   * Pode ser chamado pelo c├│digo cliente quando necess├írio
   */
  clearTranscriptions() {
    console.log('Whisper: Limpeza manual de transcri├º├Áes solicitada');
    return this._clearPreviousTranscriptions();
  }

  /**
   * Limpa transcri├º├Áes antigas quando uma nova sess├úo ├® iniciada
   * @private
   */
  _clearPreviousTranscriptions() {
    console.log('Whisper: Limpando transcri├º├Áes de sess├Áes anteriores');
    
    try {
      // 1. Limpar o hist├│rico na mem├│ria
      this.transcriptionHistory = [];
      
      // 2. Remover transcri├º├Áes antigas dessa sess├úo do sessionStorage
      if (this.sessionId) {
        sessionStorage.removeItem(`whisper_transcriptions_${this.sessionId}`);
        sessionStorage.removeItem(`last_transcript_${this.sessionId}`);
        console.log(`Whisper: Removido dados da sess├úo anterior ${this.sessionId} do sessionStorage`);
      }
      
      // 3. Remover transcri├º├Áes antigas dessa sess├úo do localStorage
      if (this.sessionId) {
        localStorage.removeItem(`whisper_transcript_${this.sessionId}`);
        console.log(`Whisper: Removido dados da sess├úo anterior ${this.sessionId} do localStorage`);
      }
      
      // 4. Notificar sobre a limpeza via evento
      this._dispatchEvent('transcriptionsCleared', {
        oldSessionId: this.sessionId
      });
      
      // 5. Se tiver AIContext, limpar o transcript
      if (window.__AI_CONTEXT) {
        if (typeof window.__AI_CONTEXT.updateTranscript === 'function') {
          window.__AI_CONTEXT.updateTranscript('');
          console.log('Whisper: Transcript limpo no AIContext');
        }
      }
      
      console.log('Whisper: Limpeza de transcri├º├Áes antigas conclu├¡da');
      return true;
    } catch (e) {
      console.error('Whisper: Erro ao limpar transcri├º├Áes antigas:', e);
      return false;
    }
  }

  /**
   * Iniciar a grava├º├úo de ├íudio e configurar detec├º├úo de sil├¬ncio
   * @returns {Promise<boolean>} - Sucesso da inicializa├º├úo da grava├º├úo
   */
  async startRecording() {
    try {
      // FIXADO: Verificar se o servi├ºo foi inicializado, se n├úo, inicializ├í-lo
      if (!this.serviceInitialized) {
        console.log('Whisper: Servi├ºo n├úo inicializado, inicializando agora...');
        this.initializeService();
      }
      
      console.log('=== INICIANDO NOVA GRAVA├ç├âO WAV ===');
      
      // NOVO: Atualizar timestamp de atividade
      this.lastActivityTime = Date.now();
      
      // Garantir que temos o sessionId mais atualizado
      const latestSessionId = this.extractSessionId();
      if (latestSessionId !== this.sessionId) {
        this.updateSessionId(latestSessionId);
      }
      
      // ESTRAT├ëGIA ANTI-CORRUP├ç├âO: For├ºar libera├º├úo m├íxima entre grava├º├Áes
      
      // 1. For├ºar parada de qualquer grava├º├úo existente
      if (this.isRecording || this.mediaRecorder) {
        console.log('Grava├º├úo anterior detectada, parando completamente...');
        await this.stopRecording(false);
        
        // Aguardar libera├º├úo de recursos pelo SO
        console.log('Aguardando 800ms para garantir libera├º├úo de recursos...');
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      // 2. Libera├º├úo COMPLETA de todos os recursos
      await this._releaseAllAudioResources();
      
      // 3. Pausa extra para garantir que o sistema operacional libere handles de arquivos
      console.log('Pausa adicional para garantir libera├º├úo total...');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 4. Reiniciar completamente o estado
      this.audioChunks = [];
      this.chunkCounter = 0;
      this.isRecording = true;
      this.chunkStartTime = Date.now();
      
      // 5. Verificar sessionId v├ílido
      if (!this.sessionId || this.sessionId.startsWith('temp_') || this.sessionId.startsWith('error_')) {
        const newId = this.extractSessionId();
        if (newId && !newId.startsWith('temp_') && !newId.startsWith('error_')) {
          this.updateSessionId(newId);
        }
        console.log(`Usando sessionId: ${this.sessionId}`);
      }
      
      // 6. Solicitar permiss├úo do microfone local
      console.log('Solicitando permiss├úo de microfone local...');
      this.audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      console.log('Permiss├úo de microfone concedida, criando novo MediaRecorder');
      
      // 7. Priorizar WAV como formato para compatibilidade com Whisper
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
      
      console.log(`Formato de grava├º├úo selecionado: ${mimeType || 'padr├úo do navegador'}`);
      
      // 8. Configurar op├º├Áes avan├ºadas para MediaRecorder
      const options = mimeType ? {
        mimeType,
        audioBitsPerSecond: 128000 // Qualidade mais baixa para evitar problemas
      } : undefined;
      
      // 9. Criar nova inst├óncia do MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.audioStream, options);
      
      // 10. Configurar evento para chunks pequenos e frequentes
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          const chunkNum = this.audioChunks.length;
          const sizeKB = Math.round(event.data.size/1024);
          console.log(`Chunk #${chunkNum} recebido: ${sizeKB}KB, tipo: ${event.data.type}`);
          this.audioChunks.push(event.data);
        }
      };
      
      // 11. Capturar erros do MediaRecorder
      this.mediaRecorder.onerror = (event) => {
        console.error('Erro no MediaRecorder:', event);
        this._dispatchEvent('recordingError', { error: 'Erro na grava├º├úo de ├íudio' });
      };
      
      // 12. Iniciar grava├º├úo com chunks MUITO pequenos para melhor controle
      this.mediaRecorder.start(300); // 300ms por chunk para maior controle
      console.log('Grava├º├úo WAV iniciada com nova inst├óncia de MediaRecorder');
      
      // 13. Configurar detec├º├úo de sil├¬ncio
      if (this.silenceDetectionEnabled) {
        this._setupSilenceDetection(this.audioStream);
      }
      
      // 14. Configurar timer para chunk m├íximo
      this._setupMaxChunkTimer();
      
      // 15. Disparar evento de in├¡cio
      this._dispatchEvent('recordingStarted', { isRecording: true });
      
      return true;
    } catch (error) {
      console.error('Erro ao iniciar grava├º├úo de ├íudio:', error);
      this._dispatchEvent('recordingError', { error: error.message });
      return false;
    }
  }

  /**
   * NOVO: M├®todo para liberar completamente todos os recursos de ├íudio
   * @private
   */
  async _releaseAllAudioResources() {
    console.log('Liberando TODOS os recursos de ├íudio...');
    
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
    
    // 2. Limpar stream de ├íudio
    if (this.audioStream) {
      try {
        // Parar todas as tracks
        this.audioStream.getTracks().forEach(track => {
          try { 
            track.stop(); 
            console.log('Track de ├íudio parada e liberada');
          } catch (e) {
            console.warn('Erro ao parar track de ├íudio:', e);
          }
        });
        
        // Definir como null para incentivar garbage collection
        this.audioStream = null;
      } catch (e) {
        console.warn('Erro ao liberar stream de ├íudio:', e);
      }
    }
    
    // 3. Limpar contexto de ├íudio
    if (this.audioContext) {
      try {
        // Fechar o contexto de ├íudio
        await this.audioContext.close();
        console.log('Contexto de ├íudio fechado');
        
        // Definir como null para incentivar garbage collection
        this.audioContext = null;
        this.audioAnalyser = null;
      } catch (e) {
        console.warn('Erro ao fechar contexto de ├íudio:', e);
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
    
    console.log('Libera├º├úo de recursos conclu├¡da');
  }

  /**
   * Configurar o timer para chunk m├íximo
   * @private
   */
  _setupMaxChunkTimer() {
    // Limpar qualquer timer existente
    if (this.maxChunkTimer) {
      clearTimeout(this.maxChunkTimer);
    }
    
    // Configurar novo timer
    this.maxChunkTimer = setTimeout(() => {
      console.log(`Chunk m├íximo de ${this.maxChunkDuration/1000}s atingido, processando ├íudio...`);
      this._processCurrentChunk();
    }, this.maxChunkDuration);
  }

  /**
   * Configurar detec├º├úo de sil├¬ncio
   * @param {MediaStream} stream - Stream de ├íudio
   * @private
   */
  _setupSilenceDetection(stream) {
    try {
      // Criar contexto de ├íudio
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.audioAnalyser = this.audioContext.createAnalyser();
      
      // Configurar analisador
      this.audioAnalyser.fftSize = 2048;
      this.audioAnalyser.smoothingTimeConstant = 0.8;
      
      // Conectar stream ao analisador
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.audioAnalyser);
      
      // Iniciar detec├º├úo
      this._detectSilence();
      
      console.log('Detec├º├úo de sil├¬ncio configurada');
    } catch (error) {
      console.error('Erro ao configurar detec├º├úo de sil├¬ncio:', error);
    }
  }

  /**
   * Detecta sil├¬ncio no ├íudio e processa chunks quando necess├írio
   * @private
   */
  _detectSilence() {
    if (!this.audioAnalyser || !this.isRecording) return;
    
    // Criar buffer para an├ílise
    const bufferLength = this.audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Obter dados de volume
    this.audioAnalyser.getByteFrequencyData(dataArray);
    
    // Calcular volume m├®dio
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;
    
    // Converter para dB (approximation)
    const volumeDb = 20 * Math.log10(average / 255);
    
    // Determinar se ├® sil├¬ncio
    const isSilence = volumeDb < this.silenceThreshold;
    
    // Verificar dura├º├úo da grava├º├úo atual
    const currentDuration = Date.now() - this.chunkStartTime;
    
    if (isSilence) {
      // Iniciar contagem de sil├¬ncio se ainda n├úo come├ºou
      if (!this.silenceStart) {
        this.silenceStart = Date.now();
        console.log('Sil├¬ncio detectado, iniciando contagem...');
      }
      
      // Verificar se o sil├¬ncio durou o suficiente
      const silenceDuration = Date.now() - this.silenceStart;
      
      // Mostrar progresso do sil├¬ncio a cada segundo
      if (silenceDuration % 1000 < 100) {
        console.log(`Sil├¬ncio: ${Math.round(silenceDuration/1000)}s / ${this.silenceDuration/1000}s`);
      }
      
      if (silenceDuration >= this.silenceDuration && currentDuration >= this.minChunkDuration) {
        // Sil├¬ncio suficiente e chunk com dura├º├úo m├¡nima, processar ├íudio
        console.log(`Sil├¬ncio atingiu ${Math.round(silenceDuration/1000)}s, processando ├íudio e pausando grava├º├úo...`);
        
        // Processar o chunk atual
        this._processCurrentChunk();
        
        // NOVO: Pausar grava├º├úo por inatividade
        this._pauseRecordingForSilence();
        
        return; // N├úo continuar a detec├º├úo
      }
    } else {
      // Resetar detec├º├úo de sil├¬ncio
      if (this.silenceStart) {
        console.log('Voz detectada, reiniciando contagem de sil├¬ncio');
        this.silenceStart = null;
      }
    }
    
    // Continuar detec├º├úo
    requestAnimationFrame(() => this._detectSilence());
  }

  /**
   * Processa o chunk atual e envia para transcri├º├úo
   * @private
   */
  async _processCurrentChunk() {
    try {
      // Verificar se temos chunks para processar
      if (!this.audioChunks || this.audioChunks.length === 0) {
        console.log('Nenhum chunk de ├íudio para processar');
        return;
      }
      
      // Verificar dura├º├úo da grava├º├úo atual
      const duration = Date.now() - this.chunkStartTime;
      
      // Se a dura├º├úo for menor que o m├¡nimo, ignorar
      if (duration < this.minChunkDuration) {
        console.log(`Dura├º├úo muito curta (${Math.round(duration/1000)}s), m├¡nimo ├® ${Math.round(this.minChunkDuration/1000)}s. Ignorando chunk.`);
        return;
      }
      
      console.log(`Processando chunk com dura├º├úo de ${Math.round(duration/1000)}s`);
      
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
      
      // Verificar tamanho m├¡nimo
      if (audioBlob.size < 1024) {
        console.log('Chunk de ├íudio muito pequeno, ignorando');
        return;
      }
      
      // Criar nome ├║nico de arquivo com extens├úo WAV
      const timestamp = Date.now();
      const randomId = Math.floor(Math.random() * 10000);
      const fileName = `audio-${timestamp}-${randomId}.wav`;
      
      // Enviar para processamento
      await this.processAudioChunks(audioBlob, fileName);
      
      // Limpar chunks processados e reiniciar grava├º├úo
      this._resetRecording();
    } catch (error) {
      console.error('Erro ao processar chunk de ├íudio:', error);
      this._dispatchEvent('recordingError', { error: error.message });
    }
  }

  /**
   * Reseta o estado de grava├º├úo
   * @private
   */
  _resetRecording() {
    // Incrementar contador de chunks processados
    this.chunkCounter++;
    
    // Limpar chunks de ├íudio
    this.audioChunks = [];
    
    // Reiniciar o tempo de in├¡cio do novo chunk
    this.chunkStartTime = Date.now();
    
    // Reiniciar o temporizador de sil├¬ncio
    this.lastAudioLevel = 0;
    this.silenceStart = null;
    
    // Reiniciar o temporizador de chunk m├íximo
    this._setupMaxChunkTimer();
    
    console.log(`Grava├º├úo resetada para chunk #${this.chunkCounter}`);
  }

  /**
   * Para a grava├º├úo e processa o ├íudio capturado
   * @param {boolean} processCurrentChunk - Se deve processar o chunk atual
   * @param {boolean} manualStop - Se a parada foi solicitada manualmente pelo usu├írio
   * @returns {Promise<void>}
   */
  async stopRecording(processCurrentChunk = true, manualStop = false) {
    console.log('=== PARANDO GRAVA├ç├âO WAV ===');
    
    // Adicionar log expl├¡cito sobre o tipo de parada
    console.log(`Tipo de parada: ${manualStop ? 'MANUAL (por usu├írio)' : 'Autom├ítica (por sistema)'}`);
    
    // Marcar se a parada foi manual (de forma mais expl├¡cita)
    this.manualStopped = manualStop === true;
    
    // NOVO: Se for parada manual, desativar explicitamente o autoRestart
    if (manualStop) {
      console.log('­ƒøæ Desativando autoRestart devido a parada manual');
      this.autoRestart = false;
    }
    
    // Se for parada manual, desativar completamente o detector de voz
    if (manualStop) {
      console.log('PARADA MANUAL detectada - desativando detec├º├úo de voz e rein├¡cio autom├ítico');
      this.pausedForSilence = false; // N├úo estamos em pausa, estamos completamente parados
      
      // Certificar-se de que a detec├º├úo de voz seja interrompida
      if (this.voiceDetectionInterval) {
        clearInterval(this.voiceDetectionInterval);
        this.voiceDetectionInterval = null;
      }
    }
    
    // For├ºar libera├º├úo de recursos mesmo que o MediaRecorder n├úo esteja ativo
    const wasRecording = this.isRecording;
    
    // Imediatamente marcar como n├úo gravando para evitar loops
    this.isRecording = false;
    
    // Parar qualquer temporizador
    if (this.maxChunkTimer) {
      clearTimeout(this.maxChunkTimer);
      this.maxChunkTimer = null;
    }
    
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    
    // Verificar se o mediaRecorder existe
    if (!this.mediaRecorder) {
      console.warn('Nenhum MediaRecorder ativo para parar');
      
      // Mesmo sem MediaRecorder, garantir limpeza completa
      await this._releaseAllAudioResources();
      
      // Notificar que a grava├º├úo foi interrompida
      this._dispatchEvent('recordingStopped', { isRecording: false });
      return;
    }
    
    try {
      // 1. Capturar refer├¬ncia aos chunks antes de limpar
      const finalAudioChunks = [...this.audioChunks];
      
      // 2. Parar grava├º├úo com seguran├ºa
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        try {
          await new Promise((resolve) => {
            // Definir um timeout curto para garantir que continue mesmo se o stop() travar
            const stopTimeout = setTimeout(() => {
              console.warn('Timeout ao parar grava├º├úo, for├ºando libera├º├úo');
              resolve();
            }, 1000); // Reduzido para 1 segundo para resposta mais r├ípida
            
            // Handler para quando o MediaRecorder parar com sucesso
            const stopHandler = () => {
              clearTimeout(stopTimeout);
              resolve();
            };
            
            // Configurar o handler antes de chamar stop()
            this.mediaRecorder.onstop = stopHandler;
            
            try {
              // Tentar parar o MediaRecorder
              this.mediaRecorder.stop();
              console.log('Comando stop() enviado ao MediaRecorder');
            } catch (e) {
              console.warn('Erro ao parar MediaRecorder, liberando recursos mesmo assim:', e);
              clearTimeout(stopTimeout);
              resolve(); // Continuar mesmo com erro
            }
          });
          
          console.log('MediaRecorder parado com sucesso');
        } catch (e) {
          console.warn('Erro ao aguardar parada do MediaRecorder, continuando com limpeza:', e);
        }
      }
      
      // 3. Liberar TODOS os recursos de ├íudio com for├ºa m├íxima
      await this._forceReleaseAudioResources();
      
      // 4. Notificar que a grava├º├úo foi interrompida
      this._dispatchEvent('recordingStopped', { isRecording: false });
      
      // 5. Processar o ├íudio capturado se solicitado e se houver dados
      if (wasRecording && processCurrentChunk && finalAudioChunks.length > 0) {
        console.log(`Processando ${finalAudioChunks.length} chunks de ├íudio ap├│s parada`);
        
        // Filtrar chunks vazios
        const validChunks = finalAudioChunks.filter(chunk => chunk && chunk.size > 0);
        
        if (validChunks.length === 0) {
          console.warn('Nenhum chunk v├ílido para processar');
          return;
        }
        
        // Aguardar libera├º├úo de recursos
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Criar blob unificado com formato WAV
        const audioBlob = new Blob(validChunks, { type: 'audio/wav' });
        
        if (audioBlob.size < 1024) {
          console.warn('Arquivo de ├íudio muito pequeno (menos de 1KB), ignorando');
          return;
        }
        
        // Gerar nome de arquivo ├║nico
        const timestamp = Date.now();
        const randomId = Math.floor(Math.random() * 100000);
        const fileName = `audio-${timestamp}-${randomId}.wav`;
        
        // Processar o blob
        console.log(`Enviando ├íudio WAV final: ${fileName}, tamanho: ${Math.round(audioBlob.size/1024)}KB`);
        this.currentFileName = fileName;
        await this.processAudioChunks(audioBlob, fileName);
        
        // Liberar refer├¬ncia
        this.currentFileName = null;
      }
      
    } catch (error) {
      console.error('Erro ao parar grava├º├úo:', error);
      this._dispatchEvent('recordingError', { error: error.message });
      
      // Garantir limpeza mesmo em caso de erro
      await this._forceReleaseAudioResources();
    }
  }
  
  /**
   * For├ºa a libera├º├úo de recursos de ├íudio, mesmo em caso de erros
   * @private
   */
  async _forceReleaseAudioResources() {
    console.log('ÔÜá´©Å FOR├çANDO LIBERA├ç├âO DE TODOS OS RECURSOS DE ├üUDIO ÔÜá´©Å');
    
    // 1. Limpar MediaRecorder
    if (this.mediaRecorder) {
      try {
        // Remover todos os event listeners para evitar callbacks indesejados
        this.mediaRecorder.ondataavailable = null;
        this.mediaRecorder.onstop = null;
        this.mediaRecorder.onerror = null;
        
        // Tentar parar se ainda estiver gravando
        if (this.mediaRecorder.state === 'recording') {
          try {
            this.mediaRecorder.stop();
          } catch (e) {
            console.warn('Erro ao for├ºar parada do MediaRecorder:', e);
          }
        }
        
        // Definir como null para incentivar garbage collection
        this.mediaRecorder = null;
      } catch (e) {
        console.warn('Erro ao liberar MediaRecorder:', e);
      }
    }
    
    // 2. Limpar stream de ├íudio
    if (this.audioStream) {
      try {
        // Parar todas as tracks
        this.audioStream.getTracks().forEach(track => {
          try { 
            track.stop(); 
            console.log('Track de ├íudio parada e liberada');
          } catch (e) {
            console.warn('Erro ao parar track de ├íudio:', e);
          }
        });
        
        // Definir como null para incentivar garbage collection
        this.audioStream = null;
      } catch (e) {
        console.warn('Erro ao liberar stream de ├íudio:', e);
      }
    }
    
    // 3. Limpar contexto de ├íudio
    if (this.audioContext) {
      try {
        // Fechar o contexto de ├íudio
        await this.audioContext.close();
        console.log('Contexto de ├íudio fechado');
        
        // Definir como null para incentivar garbage collection
        this.audioContext = null;
        this.audioAnalyser = null;
      } catch (e) {
        console.warn('Erro ao fechar contexto de ├íudio:', e);
      }
    }
    
    // 4. Limpar todos os temporizadores poss├¡veis
    if (this.maxChunkTimer) {
      clearTimeout(this.maxChunkTimer);
      this.maxChunkTimer = null;
    }
    
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    
    if (this.voiceDetectionInterval) {
      clearInterval(this.voiceDetectionInterval);
      this.voiceDetectionInterval = null;
    }
    
    // 5. Limpar todos os dados
    this.audioChunks = [];
    this.isRecording = false;
    this.pausedForSilence = false;
    
    // 6. Tenta for├ºar garbage collection
    if (window.gc) {
      try {
        window.gc();
      } catch (e) {}
    }
    
    // 7. Esperar um momento para garantir que tudo foi limpo
    await new Promise(resolve => setTimeout(resolve, 200));
    
    console.log('­ƒº╣ Libera├º├úo for├ºada de recursos completa');
  }

  /**
   * Processa os chunks de ├íudio e os envia para o servidor
   * @param {Blob} audioBlob - O blob de ├íudio a ser processado
   * @param {string} fileName - O nome do arquivo
   * @returns {Promise<void>}
   */
  async processAudioChunks(audioBlob, fileName) {
    try {
      // 1. Verificar se temos um blob v├ílido
      if (!audioBlob || audioBlob.size === 0) {
        console.error('Blob de ├íudio inv├ílido ou vazio');
        return;
      }
      
      // 2. Detectar se ├® o primeiro ├íudio ou subsequente
      const isFirstAudio = this.chunkCounter === 0;
      
      // 3. ESTRAT├ëGIA DIFERENCIADA:
      // - Primeiro ├íudio: enviar como WAV (funciona consistentemente)
      // - ├üudios subsequentes: enviar como MP3 (mais est├ível para processamento)
      const mimeType = 'audio/webm'; // Usar webm que ├® mais compat├¡vel com streaming
      const extension = '.webm';
      
      console.log(`Estrat├®gia: Enviando ├íudio #${this.chunkCounter} como WEBM (mais compat├¡vel)`);
      
      // 4. Garantir nome de arquivo ├║nico com identifica├º├úo clara
      const finalFileName = `audio-${this.chunkCounter}-${Date.now()}-${Math.floor(Math.random() * 10000)}${extension}`;
      
      // 5. Limitar o tamanho do blob para prevenir problemas HTTP/2
      let blobToSend = audioBlob;
      
      // Se o blob for maior que 1MB, reduzir a qualidade
      if (audioBlob.size > 1024 * 1024) {
        console.log(`├üudio grande detectado (${Math.round(audioBlob.size/1024)}KB), convertendo para qualidade menor`);
        try {
          // Usar abordagem com XMLHttpRequest em vez de fetch (mais est├ível para uploads grandes)
          return await this._sendAudioWithXHR(blobToSend, finalFileName);
        } catch (conversionError) {
          console.warn('Erro ao converter ├íudio, tentando enviar original:', conversionError);
          // Continuar com o blob original se a convers├úo falhar
        }
      }
      
      console.log(`Enviando ├íudio como WEBM: ${finalFileName}, tamanho: ${Math.round(blobToSend.size/1024)}KB`);
      
      // 6. Disparar evento de processamento
      this._dispatchEvent('processingAudio', {
        fileName: finalFileName,
        size: blobToSend.size,
        format: mimeType,
        isFirstChunk: isFirstAudio,
        chunkCounter: this.chunkCounter,
        duration: Math.round((Date.now() - this.chunkStartTime) / 1000)
      });
      
      // 7. Verificar se j├í existe transcri├º├úo em andamento
      if (this.transcriptionInProgress) {
        console.log('Transcri├º├úo j├í em andamento, aguardando...');
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
        
        console.log(`Tentando enviar ├íudio via XHR: ${this.apiEndpoint}, formato: ${mimeType}, arquivo: ${finalFileName}`);
        
        // Usar XHR pode evitar problemas HTTP/2 em certos navegadores
        return await this._sendAudioWithXHR(blobToSend, finalFileName);
        
      } catch (xhrError) {
        console.error('Erro ao enviar ├íudio via XHR:', xhrError);
        
        // Se o XHR falhar, tentar enviar com Fetch (m├®todo alternativo)
        try {
          console.log('Tentando m├®todo alternativo (fetch) ap├│s falha de XHR');
          
          // Preparar FormData
          const formData = new FormData();
          formData.append('file', blobToSend, finalFileName);
          formData.append('sessionId', this.sessionId);
          formData.append('chunkCounter', String(this.chunkCounter));
          formData.append('clientTimestamp', new Date().toISOString());
          formData.append('format', 'json');
          formData.append('language', 'pt');
          formData.append('speaker', this.speakerRole);
          
          // Detectar protocolo da p├ígina atual para usar o mesmo protocolo na API
          const currentProtocol = window.location.protocol;
          let endpoint = this.apiEndpoint;
          
          // Garantir que a API use o mesmo protocolo da p├ígina
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
          console.error('Tamb├®m falhou com fetch:', fetchError);
          throw fetchError;
        }
      } finally {
        this.transcriptionInProgress = false;
      }
    } catch (error) {
      console.error('Erro ao processar chunks de ├íudio:', error);
      this._dispatchEvent('transcriptionError', { error: error.message });
    }
  }
  
  /**
   * NOVO: Envia ├íudio usando XMLHttpRequest (mais robusto para uploads grandes)
   * @param {Blob} audioBlob - O blob de ├íudio
   * @param {string} fileName - Nome do arquivo
   * @returns {Promise<Object>} - Resultado da transcri├º├úo
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
            console.log('Transcri├º├úo recebida via XHR:', response);
            
            // Processar a resposta como uma resposta fetch
            const mockResponse = {
              ok: true,
              json: () => Promise.resolve(response)
            };
            
            // Processar atrav├®s do m├®todo padr├úo
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
        reject(new Error('Erro de rede na requisi├º├úo'));
      };
      
      xhr.ontimeout = () => {
        console.error('Timeout no XHR');
        reject(new Error('A requisi├º├úo excedeu o tempo limite'));
      };
      
      // Detectar protocolo da p├ígina para usar o mesmo protocolo na API
      // Isso corrige o erro de Mixed Content no navegador
      const currentProtocol = window.location.protocol;
      let endpoint = this.apiEndpoint;
      
      // Se estamos em HTTPS, garantir que a API tamb├®m use HTTPS
      if (currentProtocol === 'https:' && endpoint.startsWith('http://')) {
        endpoint = endpoint.replace('http://', 'https://');
      }
      // Se estamos em HTTP, garantir que a API tamb├®m use HTTP
      else if (currentProtocol === 'http:' && endpoint.startsWith('https://')) {
        endpoint = endpoint.replace('https://', 'http://');
      }
      
      console.log(`Enviando ├íudio para: ${endpoint} usando protocolo compat├¡vel com ${currentProtocol}`);
      
      xhr.open('POST', endpoint, true);
      
      // Preparar FormData
      const formData = new FormData();
      formData.append('file', audioBlob, fileName);
      formData.append('sessionId', this.sessionId);
      formData.append('chunkCounter', String(this.chunkCounter));
      formData.append('clientTimestamp', new Date().toISOString());
      formData.append('format', 'json');
      formData.append('language', 'pt');
      formData.append('speaker', this.speakerRole);
      
      // Enviar
      xhr.send(formData);
    });
  }

  /**
   * Processa a resposta do servidor
   * @param {Response} response - Resposta da requisi├º├úo
   * @returns {Promise<object>} - Dados processados
   * @private
   */
  async _processResponse(response) {
    try {
      // Verificar se a resposta ├® v├ílida
      if (!response.ok) {
        let errorText = 'Erro desconhecido';
        try {
          // Tentar obter mensagens de erro detalhadas
          if (response.json) {
            try {
              const errorData = await response.json();
              errorText = errorData.message || errorData.error || response.statusText;
            } catch (e) {
              // Se n├úo conseguir como JSON, tentar como texto
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
      
      // Verificar se ├® um mock de resposta XHR
      if (response.json && typeof response.json === 'function') {
        data = await response.json();
      } else if (response.data) {
        // Se j├í ├® um objeto de dados (do XHR)
        data = response.data;
      } else {
        console.error('Formato de resposta desconhecido:', response);
        throw new Error('Formato de resposta inv├ílido');
      }

      // Validar os dados
      if (!data) {
        throw new Error('Resposta vazia do servidor');
      }

      // Verificar formata├º├úo da resposta
      const text = data.text || data.transcript || data.content || data.result || (data.data ? data.data.text : null);
      
      if (!text) {
        console.error('Resposta sem texto:', data);
        this._dispatchEvent('transcriptionError', { error: 'Resposta sem texto reconhec├¡vel' });
        throw new Error('Resposta sem texto reconhec├¡vel');
      }

      console.log('Transcri├º├úo recebida:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));

      // Normalizar a resposta
      const normalizedData = {
        text: text,
        format: data.format || 'text',
        duration: data.duration || 0,
        sessionId: data.sessionId || this.sessionId
      };

      // Enviar o evento de transcri├º├úo
      this._dispatchEvent('transcription', {
        text: normalizedData.text,
        format: normalizedData.format,
        duration: normalizedData.duration,
        chunkCounter: this.chunkCounter
      });
      
      // Processar a transcri├º├úo no contexto do app
      this._processTranscription({ data: normalizedData }, null);

      // Incrementar o contador de chunks
      this.chunkCounter++;

      // Solu├º├úo: reiniciar completamente a grava├º├úo para o pr├│ximo chunk
      console.log('SOLU├ç├âO: Reiniciando grava├º├úo para evitar problemas nos ├íudios subsequentes');
      
      // Parar a grava├º├úo atual se estiver ativa
      if (this.isRecording || this.mediaRecorder) {
        await this.stopRecording(false);
      }
      
      // Liberar completamente todos os recursos
      await this._releaseAllAudioResources();
      
      // Reiniciar grava├º├úo ap├│s pequeno intervalo
      console.log("Aguardando 2 segundos antes de reiniciar grava├º├úo...");
      
      // Usar setTimeout para garantir que haja um atraso antes do rein├¡cio
      setTimeout(async () => {
        // VERIFICAR se foi parado manualmente - N├âO reiniciar se foi
        if (this.manualStopped) {
          console.log("­ƒøæ N├âO reiniciando grava├º├úo pois foi parada manualmente pelo usu├írio");
          // Emitir um evento adicional para garantir que a UI sincronize
          this._dispatchEvent('manualStopConfirmed', { message: 'Grava├º├úo permanece parada conforme solicitado pelo usu├írio' });
          return; // Sair do setTimeout sem reiniciar
        }
        
        console.log("Reiniciando grava├º├úo automaticamente...");
        try {
          // For├ºar a flag autoRestart para true
          this.autoRestart = true;
          
          const result = await this.startRecording();
          console.log(`Resultado do rein├¡cio autom├ítico: ${result ? 'SUCESSO' : 'FALHA'}`);
          
          if (!result) {
            console.error("Falha no rein├¡cio autom├ítico, tentando novamente em 3 segundos");
            setTimeout(() => {
              console.log("Tentativa de recupera├º├úo ap├│s falha no rein├¡cio");
              this.startRecording();
            }, 3000);
          }
        } catch (e) {
          console.error("Erro ao reiniciar grava├º├úo automaticamente:", e);
          // Tentar novamente ap├│s um intervalo maior
          setTimeout(() => {
            console.log("Tentativa de recupera├º├úo ap├│s ERRO no rein├¡cio");
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
   * Obt├®m todo o texto transcrito acumulado
   * @returns {string} Texto completo das transcri├º├Áes
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
   * Despacha um evento padronizado do servi├ºo Whisper
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

  // Adicionar configura├º├úo para controlar o rein├¡cio autom├ítico
  setAutoRestart(enable) {
    this.autoRestart = enable;
    
    // Se desativar o rein├¡cio e estiver em pausa, cancelar detec├º├úo de voz
    if (!enable && this.pausedForSilence) {
      if (this.voiceDetectionInterval) {
        clearInterval(this.voiceDetectionInterval);
        this.voiceDetectionInterval = null;
      }
      this.pausedForSilence = false;
    }
    
    console.log(`Rein├¡cio autom├ítico ${enable ? 'ativado' : 'desativado'}`);
    this._dispatchEvent('statusChange', { 
      status: 'config', 
      autoRestart: enable,
      message: `Rein├¡cio autom├ítico ${enable ? 'ativado' : 'desativado'}`
    });
  }

  /**
   * For├ºa o rein├¡cio da grava├º├úo de ├íudio
   * @returns {Promise<boolean>} - Sucesso do rein├¡cio
   */
  async forceRestartRecording() {
    console.log('=== FOR├çANDO REIN├ìCIO COMPLETO DA GRAVA├ç├âO ===');
    
    try {
      // 1. Parar qualquer grava├º├úo em andamento
      if (this.isRecording || this.mediaRecorder) {
        await this.stopRecording(false);
      }
      
      // 2. Liberar TODOS os recursos
      await this._releaseAllAudioResources();
      
      // 3. Esperar um tempo para garantir a libera├º├úo completa
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 4. Resetar contador para garantir que seja tratado como primeiro ├íudio
      this.chunkCounter = 0;
      console.log('Contador de chunks resetado para 0 - pr├│ximo ├íudio ser├í tratado como primeiro');
      
      // 5. Iniciar nova grava├º├úo do zero
      console.log('Iniciando nova grava├º├úo for├ºada');
      const success = await this.startRecording();
      
      console.log(`Rein├¡cio for├ºado ${success ? 'bem-sucedido' : 'falhou'}`);
      return success;
    } catch (error) {
      console.error('Erro ao for├ºar rein├¡cio da grava├º├úo:', error);
      
      // Tentar novamente com mais tempo de espera
      try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('Tentando novamente o rein├¡cio for├ºado ap├│s erro...');
        return await this.startRecording();
      } catch (retryError) {
        console.error('Falha na segunda tentativa de rein├¡cio:', retryError);
        return false;
      }
    }
  }

  /**
   * NOVO: Pausa a grava├º├úo por inatividade/sil├¬ncio
   * @private
   */
  async _pauseRecordingForSilence() {
    console.log('=== PAUSANDO GRAVA├ç├âO POR SIL├èNCIO ===');
    
    // Se a parada foi manual, n├úo reiniciar
    if (this.manualStopped) {
      console.log('N├úo iniciando detec├º├úo de voz pois grava├º├úo foi parada manualmente');
      return;
    }
    
    try {
      // Marcar como pausado por sil├¬ncio
      this.pausedForSilence = true;
      
      // Parar a grava├º├úo sem processar o ├íudio (j├í foi processado)
      await this.stopRecording(false);
      
      // Iniciar detec├º├úo de voz para retomar grava├º├úo apenas se autoRestart estiver ativo
      if (this.autoRestart) {
        this._startVoiceDetection();
        console.log('Grava├º├úo pausada por sil├¬ncio. Aguardando voz para reiniciar...');
      } else {
        console.log('Grava├º├úo pausada por sil├¬ncio. Rein├¡cio autom├ítico desativado.');
      }
    } catch (error) {
      console.error('Erro ao pausar grava├º├úo por sil├¬ncio:', error);
    }
  }
  
  /**
   * NOVO: Inicia detec├º├úo de voz ap├│s pausa por sil├¬ncio
   * @private
   */
  _startVoiceDetection() {
    // Se a parada foi manual, n├úo iniciar detec├º├úo
    if (this.manualStopped) {
      console.log('N├úo iniciando detec├º├úo de voz pois grava├º├úo foi parada manualmente');
      return;
    }
    
    // Limpar qualquer intervalo existente
    if (this.voiceDetectionInterval) {
      clearInterval(this.voiceDetectionInterval);
    }
    
    console.log('Iniciando detec├º├úo de voz para retomar grava├º├úo...');
    
    // Verificar se temos permiss├úo para usar o microfone
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        // Configurar contexto de ├íudio para analisar volume
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        
        analyser.fftSize = 256;
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Iniciar verifica├º├úo a cada 300ms
        this.voiceDetectionInterval = setInterval(() => {
          if (!this.pausedForSilence) {
            // Se n├úo estamos mais pausados, limpar recursos
            clearInterval(this.voiceDetectionInterval);
            stream.getTracks().forEach(track => track.stop());
            audioContext.close();
            return;
          }
          
          // Obter dados de volume
          analyser.getByteFrequencyData(dataArray);
          
          // Calcular volume m├®dio
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          
          // Converter para dB
          const volumeDb = 20 * Math.log10(average / 255);
          
          // Se volume for maior que o limiar, detectamos voz
          if (volumeDb > this.voiceThreshold) {
            console.log(`Voz detectada! (${volumeDb.toFixed(1)} dB) - Reiniciando grava├º├úo!`);
            
            // Limpar intervalo e recursos
            clearInterval(this.voiceDetectionInterval);
            stream.getTracks().forEach(track => track.stop());
            audioContext.close();
            
            // Reiniciar grava├º├úo
            this.pausedForSilence = false;
            this.forceRestartRecording();
          }
        }, 300);
      })
      .catch(err => {
        console.error('Erro ao acessar microfone para detec├º├úo de voz:', err);
      });
  }

  /**
   * MODIFICADO: Processar a transcri├º├úo recebida
   * @param {Object} response - Resposta da API
   * @param {Blob} audioBlob - Blob de ├íudio enviado (para debug)
   * @private
   */
  async _processTranscription(response, audioBlob) {
    try {
      // Validar resposta
      if (!response || !response.data) {
        throw new Error('Resposta de transcri├º├úo inv├ílida');
      }
      
      const transcription = response.data.text || response.data.transcript || response.data;
      
      // Obter identificador completo do papel (inclui status de host)
      const speakerIdentifier = this._getSpeakerIdentifier();
      const isHost = this._isSessionHost();
      
      // MELHORIA: Adicionar formata├º├úo melhorada para visualiza├º├úo no console
      // Mostrar claramente quem ├® o falante com distin├º├úo entre host e convidado
      let speakerLabel = this.speakerRole.toUpperCase();
      let bgColor = this.speakerRole === 'therapist' ? '#4CAF50' : '#2196F3';
      
      // Adicionar indicador de host para terapeutas
      if (this.speakerRole === 'therapist') {
        if (isHost) {
          speakerLabel = 'TERAPEUTA (ANFITRI├âO)';
          bgColor = '#4CAF50'; // Verde para terapeuta anfitri├úo
        } else {
          speakerLabel = 'TERAPEUTA (CONVIDADO)';
          bgColor = '#009688'; // Verde azulado para terapeuta convidado
        }
      } else if (this.speakerRole === 'client') {
        speakerLabel = 'CLIENTE';
      }
      
      console.log(
        `\n%c ${speakerLabel} DISSE: %c ${transcription.substring(0, 200)}${transcription.length > 200 ? '...' : ''}\n`, 
        `background: ${bgColor}; 
         color: white; 
         font-weight: bold; 
         padding: 5px; 
         border-radius: 3px 0 0 3px;`,
        `background: #f8f8f8; 
         color: #333; 
         padding: 5px; 
         border-radius: 0 3px 3px 0; 
         border-left: 5px solid ${bgColor};`
      );
      
      // Log adicional da sess├úo para rastreamento
      console.log(
        `%c SESS├âO: %c ${this.sessionId} %c PAPEL: %c ${speakerIdentifier} %c TIMESTAMP: %c ${new Date().toLocaleTimeString()}`, 
        'font-weight: bold; color: #9E9E9E;', 
        'color: #9E9E9E;',
        'font-weight: bold; color: #9E9E9E;', 
        'color: #9E9E9E;',
        'font-weight: bold; color: #9E9E9E;', 
        'color: #9E9E9E;'
      );
      
      // Validar transcri├º├úo
      if (!transcription || transcription.trim().length === 0) {
        console.warn('Transcri├º├úo vazia recebida, ignorando...');
        return false;
      }
      
      // Formato para envio para o AI Context
      const transcriptionData = {
        sessionId: this.sessionId,
        speaker: this.speakerRole,
        speakerIdentifier: speakerIdentifier, // Novo campo com identificador completo
        isHost: isHost, // Novo campo indicando se ├® o anfitri├úo
        content: transcription.trim(),
        timestamp: new Date().toISOString()
      };
      
      console.log(`Processando transcri├º├úo para sess├úo ${this.sessionId} como ${this.speakerRole}`);
      
      // NOVO: Salvar no sessionStorage imediatamente como backup
      this._saveTranscriptionToStorage(transcriptionData);
      
      // CORRE├ç├âO: Usar nossa nova fun├º├úo para enviar a transcri├º├úo para o backend
      await this._sendTranscriptionToBackend(transcriptionData);
      
      // Adicionar ao estado local, ├║til para manuten├º├úo do hist├│rico
      // e para casos em que o app n├úo tem conex├úo com o backend
      this.transcriptionHistory.push(transcriptionData);
      
      // Disparar evento de nova transcri├º├úo
      this._dispatchEvent('transcriptionReceived', {
        transcript: transcription,
        ...transcriptionData
      });
      
      // MELHORIA: Armazenar no localStorage para recupera├º├úo posterior
      try {
        const sessionId = transcriptionData.sessionId;
        const key = `whisper_transcript_${sessionId}`;
        
        // Recuperar transcri├º├Áes existentes
        let existingTranscripts = [];
        const storedData = localStorage.getItem(key);
        if (storedData) {
          try {
            existingTranscripts = JSON.parse(storedData);
          } catch (e) {
            console.warn('Erro ao recuperar transcri├º├Áes armazenadas:', e);
          }
        }
        
        // Adicionar nova transcri├º├úo
        existingTranscripts.push(transcriptionData);
        
        // Salvar no localStorage
        localStorage.setItem(key, JSON.stringify(existingTranscripts));
        console.log('Transcri├º├úo salva no localStorage para recupera├º├úo futura');
        
        // MELHORIA: Atualizar diretamente o estado do transcript no AIContext
        if (window.__AI_CONTEXT) {
          const currentTranscript = window.__AI_CONTEXT.transcript || '';
          const newTranscript = currentTranscript 
            ? `${currentTranscript}\n${transcriptionData.speaker}: ${transcriptionData.content}`
            : `${transcriptionData.speaker}: ${transcriptionData.content}`;
          
          // Se o AIContext tem uma fun├º├úo para atualizar o transcript, us├í-la
          if (typeof window.__AI_CONTEXT.updateTranscript === 'function') {
            window.__AI_CONTEXT.updateTranscript(newTranscript);
            console.log('Transcript atualizado diretamente no AIContext via updateTranscript');
          } else {
            // Caso contr├írio, disparar um evento para o AIContext atualizar o transcript
            window.dispatchEvent(new CustomEvent('transcript-updated', { 
              detail: { fullText: newTranscript }
            }));
            console.log('Evento transcript-updated disparado para atualizar AIContext');
          }
        }
      } catch (storageError) {
        console.warn('Erro ao salvar transcri├º├úo no localStorage:', storageError);
      }
      
      // Tentar encontrar o AI Context e salvar a transcri├º├úo
      try {
        // Notificar via evento global que capturamos transcri├º├úo
        window.dispatchEvent(new CustomEvent('whisper-transcription', { 
          detail: transcriptionData
        }));
        
        // Tentar usar o AIContext se dispon├¡vel
        if (window.__AI_CONTEXT && window.__AI_CONTEXT.saveTranscript) {
          console.log('AIContext encontrado, salvando transcri├º├úo via contexto...');
          const result = await window.__AI_CONTEXT.saveTranscript(transcriptionData);
          
          // CORRE├ç├âO: REMOVIDO chamada autom├ítica para suggest() para evitar sugest├Áes duplicadas
          // quando HybridAI e Whisper est├úo sendo usados simultaneamente
          
          // Verificar se existe flag global indicando que o HybridAI est├í ativo
          const hybridAIActive = window.__HYBRID_AI_ACTIVE || 
                                (window.__AI_CONTEXT && window.__AI_CONTEXT.hybridAIActive);
          
          if (result && result.success && !hybridAIActive) {
            // Apenas disparar um evento para notificar que h├í nova transcri├º├úo
            // sem chamar diretamente o suggest()
            console.log('Transcri├º├úo salva com sucesso, notificando via evento');
            
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
      console.error('Erro ao processar transcri├º├úo:', error);
      return false;
    }
  }

  /**
   * Envia uma transcri├º├úo para o backend
   * @param {Object} data - Dados da transcri├º├úo
   * @returns {Promise<Object>} Resultado do envio
   * @private
   */
  async _sendTranscriptionToBackend(data) {
    try {
      // Obter token de autentica├º├úo
      const authToken = localStorage.getItem('authToken') || 
                        sessionStorage.getItem('authToken') || 
                        localStorage.getItem('token') || 
                        sessionStorage.getItem('token');
      
      if (!authToken) {
        console.error('Whisper: Token de autentica├º├úo n├úo encontrado para envio de transcri├º├úo');
        return { success: false, error: 'Token de autentica├º├úo n├úo encontrado' };
      }
      
      // CORRE├ç├âO: Obter ID de sess├úo v├ílido do DOM ou localStorage
      // Em vez de usar um ID fixo, tente obter o ID correto da sess├úo atual
      let sessionId = null;
      
      // 1. Tente obter dos par├ómetros da URL primeiro (mais confi├ível)
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const pathSegments = window.location.pathname.split('/');
        
        // Procurar em par├ómetros da URL
        if (urlParams.has('sessionId')) {
          sessionId = urlParams.get('sessionId');
        } 
        // Procurar em segmentos do path (/session/{id})
        else if (pathSegments.includes('session') && pathSegments.length > pathSegments.indexOf('session') + 1) {
          sessionId = pathSegments[pathSegments.indexOf('session') + 1];
        }
        
        // Se n├úo encontrou, procurar ID de formato UUID em qualquer posi├º├úo do path
        if (!sessionId) {
          const uuidMatch = window.location.pathname.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
          if (uuidMatch) {
            sessionId = uuidMatch[0];
          }
        }
      } catch (urlError) {
        console.warn('Erro ao extrair sessionId da URL:', urlError);
      }
      
      // 2. Se n├úo encontrou na URL, tente obter do localStorage ou sessionStorage
      if (!sessionId) {
        sessionId = localStorage.getItem('currentSessionId') || 
                    sessionStorage.getItem('currentSessionId') ||
                    localStorage.getItem('sessionId') ||
                    sessionStorage.getItem('sessionId');
      }
      
      // 3. Se ainda n├úo encontrou, procurar por qualquer elemento na p├ígina com data-session-id
      if (!sessionId) {
        const sessionElement = document.querySelector('[data-session-id]');
        if (sessionElement) {
          sessionId = sessionElement.getAttribute('data-session-id');
        }
      }
      
      // 4. Se ainda n├úo encontrou, procurar vari├ível global __AI_CONTEXT
      if (!sessionId && window.__AI_CONTEXT && window.__AI_CONTEXT.sessionId) {
        sessionId = window.__AI_CONTEXT.sessionId;
      }
      
      // 5. Se ainda n├úo encontrou, tente usar o ID que veio no par├ómetro da fun├º├úo
      if (!sessionId && data.sessionId) {
        sessionId = data.sessionId;
      }
      
      // 6. Se ainda n├úo tem ID, usar um ID fixo como ├║ltimo recurso
      if (!sessionId) {
        // HACK: Usar um ID que possui alta probabilidade de existir
        // Isso ├® um fallback para evitar erros 404
        sessionId = 'temp_session';
      }
      
      console.log(`Whisper: Usando sessionId: ${sessionId}`);
      
      // Usar o ID de sess├úo encontrado
      data.sessionId = sessionId;
      
      // CORRE├ç├âO: Garantir que temos o speaker (padr├úo 'user')
      if (!data.speaker) {
        data.speaker = 'user';
      }
      
      // CORRE├ç├âO: Garantir que temos o conte├║do na propriedade correta
      if (data.transcript && !data.content) {
        data.content = data.transcript;
      } else if (!data.content && data.text) {
        data.content = data.text;
      }
      
      // CORRE├ç├âO: Garantir que transcript tamb├®m existe (propriedade exigida pelo endpoint /api/ai/transcript)
      if (!data.transcript && data.content) {
        data.transcript = data.content;
      }
      
      // NOVO: Adicionar identificador ├║nico para esta transcri├º├úo
      data.id = data.id || `${this.speakerRole}_${Date.now()}`;
      
      // NOVO: Adicionar informa├º├úo sobre speakerIdentifier
      if (!data.speakerIdentifier) {
        data.speakerIdentifier = this.speakerIdentifier;
      }
      
      // NOVO: Adicionar informa├º├úo sobre ser host
      if (typeof data.isHost !== 'boolean') {
        data.isHost = this.isHost;
      }
      
      console.log('Whisper: Enviando transcri├º├úo para backend:', {
        sessionId: data.sessionId,
        speaker: data.speaker,
        speakerIdentifier: data.speakerIdentifier,
        contentLength: data.content?.length || 0,
        endpoint: this.transcriptEndpoint
      });
      
      // CORRE├ç├âO: Construir payload apropriado para cada endpoint
      const transcriptionsPayload = {
        id: data.id,
        sessionId: sessionId,
        speaker: data.speaker,
        speakerIdentifier: data.speakerIdentifier,
        isHost: data.isHost,
        content: data.content,
        timestamp: data.timestamp || new Date().toISOString()
      };
      
      const transcriptPayload = {
        id: data.id,
        sessionId: sessionId,
        transcript: data.content || data.transcript,
        speaker: data.speaker,
        speakerIdentifier: data.speakerIdentifier,
        isHost: data.isHost,
        timestamp: data.timestamp || new Date().toISOString()
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
          console.log(`Whisper: Transcri├º├úo enviada com sucesso para: ${this.transcriptEndpoint}`);
          
          // NOVO: Atualizar transcri├º├Áes imediatamente
          this._fetchOtherParticipantsTranscriptions();
          
          return { success: true };
        } else {
          const errorText = await response.text();
          console.warn(`Whisper: Erro ao enviar para ${this.transcriptEndpoint} (${response.status}): ${errorText}`);
          
          // Se o erro foi 404 (endpoint n├úo existe), tentar com caminho alternativo
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
              console.log(`Whisper: Transcri├º├úo enviada com sucesso para endpoint alternativo: ${alternativeEndpoint}`);
              
              // NOVO: Atualizar transcri├º├Áes imediatamente
              this._fetchOtherParticipantsTranscriptions();
              
              return { success: true };
            }
          }
        }
      } catch (primaryError) {
        console.warn(`Whisper: Erro ao enviar para endpoint prim├írio:`, primaryError);
      }
      
      // Se falhou com o endpoint principal, salvar localmente
      // Isso garante que pelo menos temos os dados no cliente
      this._saveTranscriptionToStorage(transcriptionsPayload);
      
      // Continuar opera├º├úo normal mesmo em caso de falha do backend
      // N├úo devemos interromper a experi├¬ncia do usu├írio
      return { 
        success: false, 
        error: 'Falha ao enviar transcri├º├úo para o backend, mas dados foram salvos localmente'
      };
    } catch (error) {
      console.error('Whisper: Erro ao enviar transcri├º├úo:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * NOVO: Salvar transcri├º├úo no sessionStorage como backup
   * @param {Object} transcription - A transcri├º├úo a ser salva
   * @private
   */
  _saveTranscriptionToStorage(transcription) {
    try {
      if (!transcription || !transcription.sessionId || !transcription.content) {
        return false;
      }
      
      // Usar sessionStorage para maior seguran├ºa
      const key = `whisper_transcriptions_${transcription.sessionId}`;
      
      // Obter transcri├º├Áes existentes
      let transcriptions = [];
      const stored = sessionStorage.getItem(key);
      
      if (stored) {
        try {
          transcriptions = JSON.parse(stored);
          if (!Array.isArray(transcriptions)) {
            transcriptions = [];
          }
        } catch (e) {
          console.warn('Erro ao recuperar transcri├º├Áes armazenadas:', e);
          transcriptions = [];
        }
      }
      
      // Adicionar nova transcri├º├úo
      transcriptions.push({
        ...transcription,
        clientTimestamp: Date.now()
      });
      
      // Salvar de volta
      sessionStorage.setItem(key, JSON.stringify(transcriptions));
      console.log(`Transcri├º├úo salva no sessionStorage: ${key}, total: ${transcriptions.length}`);
      
      // Tamb├®m salvar a ├║ltima transcri├º├úo separadamente
      sessionStorage.setItem(`last_transcript_${transcription.sessionId}`, JSON.stringify(transcription));
      
      return true;
    } catch (e) {
      console.warn('Erro ao salvar transcri├º├úo no sessionStorage:', e);
      return false;
    }
  }

  /**
   * NOVO: Inicia o intervalo para buscar transcri├º├Áes de outros participantes
   * @private
   */
  _startFetchingOtherTranscriptions() {
    // Limpar qualquer intervalo existente
    if (this.transcriptionFetchInterval) {
      clearInterval(this.transcriptionFetchInterval);
    }
    
    // Definir intervalo para buscar as transcri├º├Áes a cada 5 segundos
    this.transcriptionFetchInterval = setInterval(() => {
      console.log(`­ƒöä BUSCA: Tentando buscar transcri├º├Áes de outros participantes para sess├úo ${this.sessionId}`);
      this._fetchOtherParticipantsTranscriptions();
    }, 5000); // A cada 5 segundos
    
    // Buscar imediatamente
    console.log(`­ƒöä BUSCA INICIAL: Buscando transcri├º├Áes de outros participantes para sess├úo ${this.sessionId}`);
    this._fetchOtherParticipantsTranscriptions();
    
    console.log('Ô£à SISTEMA DE CONSOLIDA├ç├âO: Intervalo iniciado para buscar transcri├º├Áes de outros participantes');
  }
  
  /**
   * NOVO: Busca transcri├º├Áes de outros participantes da mesma sess├úo
   * @private
   */
  async _fetchOtherParticipantsTranscriptions() {
    try {
      // Verificar se temos um ID de sess├úo v├ílido
      if (!this.sessionId || this.sessionId.startsWith('temp_') || this.sessionId.startsWith('error_')) {
        console.log(`ÔÜá´©Å BUSCA: SessionId inv├ílido: ${this.sessionId}, cancelando busca`);
        return;
      }
      
      // Limpar o hist├│rico de transcri├º├Áes antigas se exceder um limite
      if (this.otherParticipantsTranscriptions.length > 100) {
        console.log(`­ƒº╣ LIMPEZA: Hist├│rico de transcri├º├Áes excedeu 100 itens, mantendo apenas as 50 mais recentes`);
        this.otherParticipantsTranscriptions = this.otherParticipantsTranscriptions
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 50);
      }
      
      // Obter token de autentica├º├úo
      const authToken = localStorage.getItem('authToken') || 
                        sessionStorage.getItem('authToken') || 
                        localStorage.getItem('token') || 
                        sessionStorage.getItem('token');
      
      if (!authToken) {
        console.warn('ÔØî BUSCA: Token de autentica├º├úo n├úo encontrado para buscar transcri├º├Áes');
        return;
      }
      
      // CORRIGIDO: Garantir URL absoluta em produ├º├úo
      let url = `${this.allTranscriptsEndpoint}/${this.sessionId}`;
      
      // Adicionar timestamp para buscar apenas as novas desde a ├║ltima vez
      if (this.lastFetchTimestamp) {
        // Usar ? se for a primeira query param, & se n├úo for
        url += url.includes('?') ? '&' : '?';
        url += `since=${encodeURIComponent(this.lastFetchTimestamp)}`;
      }
      
      console.log(`­ƒîÉ BUSCA: Buscando transcri├º├Áes no endpoint: ${url}`);
      
      // Fazer a requisi├º├úo para o backend
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Se recebermos texto em vez de JSON, provavelmente ├® HTML de erro
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        console.warn(`ÔÜá´©Å BUSCA: Resposta recebida como HTML, endpoint incorreto ou erro 404`);
        
        // Tentar endpoint alternativo absoluto para maior confiabilidade
        const alternativeUrl = this.isProd ? 
          `https://theraconnect-prd.onrender.com/api/transcripts/${this.sessionId}` : 
          `/api/transcripts/${this.sessionId}`;
        
        console.log(`­ƒöä BUSCA: Tentando endpoint alternativo: ${alternativeUrl}`);
        
        const altResponse = await fetch(alternativeUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (altResponse.ok) {
          const altContentType = altResponse.headers.get("content-type");
          if (altContentType && altContentType.includes("application/json")) {
            console.log(`Ô£à BUSCA: Endpoint alternativo funcionou!`);
            const data = await altResponse.json();
            console.log(`­ƒôï BUSCA: Dados recebidos do endpoint alternativo:`, data);
            this._processOtherTranscriptions(data);
            return;
          }
        }
        
        // Verificar status 404 (endpoint n├úo existe)
        if (!response.ok || !altResponse.ok) {
          console.warn(`ÔØî BUSCA: Erro nos endpoints: Principal=${response.status}, Alternativo=${altResponse.status}`);
        }
        
        return;
      }
      
      // Se n├úo tiver sucesso e n├úo for HTML, tentar endpoint alternativo
      if (!response.ok) {
        console.warn(`ÔÜá´©Å BUSCA: Erro no endpoint principal: ${response.status} ${response.statusText}`);
        return;
      }
      
      // Processar resposta
      const data = await response.json();
      console.log(`­ƒôï BUSCA: Resposta recebida do backend com ${data.data?.length || 0} transcri├º├Áes`);
      this._processOtherTranscriptions(data);
    } catch (error) {
      // MELHORADO: Tratamento espec├¡fico para erro de parsing JSON (HTML em vez de JSON)
      if (error instanceof SyntaxError && error.message.includes('Unexpected token')) {
        console.warn(`ÔØî BUSCA: Erro ao analisar resposta do servidor - recebido HTML em vez de JSON`);
      } else {
        console.warn(`ÔØî BUSCA: Erro ao buscar transcri├º├Áes de outros participantes:`, error);
      }
    }
  }
  
  /**
   * NOVO: Processa as transcri├º├Áes recebidas de outros participantes
   * @param {Object} data - Dados recebidos do backend
   * @private
   */
  _processOtherTranscriptions(data) {
    try {
      // Verificar se temos dados v├ílidos
      // CORRIGIDO: Verificar o formato correto retornado pelo backend
      const transcripts = data.data || data.transcripts || (Array.isArray(data) ? data : null);
      
      if (!transcripts || !Array.isArray(transcripts)) {
        console.warn(`ÔÜá´©Å PROCESSAMENTO: Dados inv├ílidos recebidos:`, data);
        return;
      }
      
      // Criar um conjunto de IDs j├í processados para verifica├º├úo r├ípida
      const processedIds = new Set(
        this.otherParticipantsTranscriptions.map(t => t.id || `${t.timestamp}_${t.speaker}_${t.content?.substring(0, 20)}`)
      );
      
      // Filtrar apenas as transcri├º├Áes de outros participantes (n├úo o usu├írio atual)
      // E que ainda n├úo foram processadas (n├úo est├úo no conjunto de IDs)
      const newTranscriptions = transcripts.filter(t => {
        // Verificar se n├úo ├® do usu├írio atual
        const isFromOthers = t.speaker !== this.speakerRole && t.speakerIdentifier !== this.speakerIdentifier;
        
        if (!isFromOthers) return false;
        
        // Criar um ID ├║nico para esta transcri├º├úo
        const transcriptionId = t.id || `${t.timestamp}_${t.speaker}_${t.content?.substring(0, 20)}`;
        
        // Verificar se j├í foi processada
        const isDuplicate = processedIds.has(transcriptionId);
        
        // Se for duplicada, apenas mencionar no log sem poluir com muitas mensagens
        if (isDuplicate) {
          // Reduzir logging de duplicados, apenas mencionando o total
          return false;
        }
        
        // Se chegou aqui, ├® uma nova transcri├º├úo v├ílida
        return true;
      });
      
      // Log resumido para n├úo poluir o console
      const duplicatesCount = transcripts.length - newTranscriptions.length;
      if (duplicatesCount > 0) {
        console.log(`­ƒöä PROCESSAMENTO: ${duplicatesCount} transcri├º├Áes duplicadas ignoradas`);
      }
      
      console.log(`Ô£à PROCESSAMENTO: ${newTranscriptions.length} novas transcri├º├Áes de outros participantes`);
      
      // Se n├úo h├í novas transcri├º├Áes, retornar
      if (newTranscriptions.length === 0) {
        return;
      }
      
      // Adicionar todas as novas transcri├º├Áes ao array local
      for (const transcription of newTranscriptions) {
        this.otherParticipantsTranscriptions.push(transcription);
        
        // Processar e exibir cada transcri├º├úo
        this._displayOtherParticipantTranscription(transcription);
      }
      
      // Atualizar timestamp da ├║ltima busca
      this.lastFetchTimestamp = new Date().toISOString();
    } catch (error) {
      console.warn(`ÔØî PROCESSAMENTO: Erro ao processar transcri├º├Áes de outros participantes:`, error);
    }
  }
  
  /**
   * NOVO: Exibe a transcri├º├úo de outro participante no console
   * @param {Object} transcription - Dados da transcri├º├úo
   * @private
   */
  _displayOtherParticipantTranscription(transcription) {
    try {
      // Determinar r├│tulo e cor do falante
      let speakerLabel = 'DESCONHECIDO';
      let bgColor = '#9E9E9E';
      
      // Verificar papel do falante
      if (transcription.speaker === 'therapist' || transcription.speakerIdentifier?.includes('therapist')) {
        if (transcription.speakerIdentifier === 'therapist_host') {
          speakerLabel = 'TERAPEUTA (ANFITRI├âO)';
          bgColor = '#4CAF50';
        } else if (transcription.speakerIdentifier === 'therapist_guest') {
          speakerLabel = 'TERAPEUTA (CONVIDADO)';
          bgColor = '#009688';
        } else {
          speakerLabel = 'TERAPEUTA';
          bgColor = '#4CAF50';
        }
      } else if (transcription.speaker === 'client' || transcription.speakerIdentifier === 'client') {
        speakerLabel = 'CLIENTE';
        bgColor = '#2196F3';
      }
      
      // Obter o conte├║do da transcri├º├úo
      const content = transcription.content || transcription.transcript || transcription.text || '';
      
      // Exibir no console com formato adequado
      console.log(
        `\n%c ${speakerLabel} DISSE: %c ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}\n`, 
        `background: ${bgColor}; 
         color: white; 
         font-weight: bold; 
         padding: 5px; 
         border-radius: 3px 0 0 3px;`,
        `background: #f8f8f8; 
         color: #333; 
         padding: 5px; 
         border-radius: 0 3px 3px 0; 
         border-left: 5px solid ${bgColor};`
      );
      
      // Log adicional da sess├úo para rastreamento
      console.log(
        `%c SESS├âO: %c ${this.sessionId} %c PAPEL: %c ${transcription.speakerIdentifier || transcription.speaker} %c TIMESTAMP: %c ${new Date(transcription.timestamp).toLocaleTimeString()}`, 
        'font-weight: bold; color: #9E9E9E;', 
        'color: #9E9E9E;',
        'font-weight: bold; color: #9E9E9E;', 
        'color: #9E9E9E;',
        'font-weight: bold; color: #9E9E9E;', 
        'color: #9E9E9E;'
      );
      
      // Disparar evento para notificar sobre nova transcri├º├úo de outro participante
      this._dispatchEvent('otherParticipantTranscription', {
        transcript: content,
        speaker: transcription.speaker,
        speakerIdentifier: transcription.speakerIdentifier,
        sessionId: this.sessionId,
        timestamp: transcription.timestamp
      });
    } catch (error) {
      console.warn('Erro ao exibir transcri├º├úo de outro participante:', error);
    }
  }
  
  /**
   * NOVO: Limpa os recursos quando o componente ├® destru├¡do
   */
  destroy() {
    try {
      // Parar a grava├º├úo se estiver ativa
      if (this.isRecording) {
        this.stopRecording(false);
      }
      
      // Liberar recursos de ├íudio
      this._releaseAllAudioResources();
      
      // Limpar o intervalo de busca de transcri├º├Áes
      if (this.transcriptionFetchInterval) {
        clearInterval(this.transcriptionFetchInterval);
        this.transcriptionFetchInterval = null;
      }
      
      // Limpar detector de voz
      if (this.voiceDetectionInterval) {
        clearInterval(this.voiceDetectionInterval);
        this.voiceDetectionInterval = null;
      }
      
      console.log('WhisperTranscriptionService destru├¡do e recursos liberados');
    } catch (error) {
      console.error('Erro ao destruir WhisperTranscriptionService:', error);
    }
  }
  
  /**
   * NOVO: Retorna todas as transcri├º├Áes consolidadas (pr├│prias e de outros participantes)
   * @returns {Array} Array de transcri├º├Áes ordenadas por timestamp
   */
  getAllTranscriptions() {
    try {
      // Combinar transcri├º├Áes pr├│prias e de outros participantes
      const allTranscriptions = [
        ...this.transcriptionHistory,
        ...this.otherParticipantsTranscriptions
      ];
      
      // Ordenar por timestamp
      return allTranscriptions.sort((a, b) => {
        const timestampA = new Date(a.timestamp).getTime();
        const timestampB = new Date(b.timestamp).getTime();
        return timestampA - timestampB;
      });
    } catch (error) {
      console.warn('Erro ao obter todas as transcri├º├Áes:', error);
      return [];
    }
  }
  
  /**
   * NOVO: Retorna um texto consolidado com todas as transcri├º├Áes, formatado como di├ílogo
   * @returns {string} Texto formatado com todas as transcri├º├Áes
   */
  getConsolidatedTranscriptionText() {
    try {
      const allTranscriptions = this.getAllTranscriptions();
      
      if (allTranscriptions.length === 0) {
        return 'Nenhuma transcri├º├úo dispon├¡vel';
      }
      
      // Construir o texto formatado
      return allTranscriptions.map(t => {
        // Determinar o r├│tulo do falante
        let speakerLabel = '';
        
        if (t.speakerIdentifier === 'therapist_host') {
          speakerLabel = 'Terapeuta (anfitri├úo)';
        } else if (t.speakerIdentifier === 'therapist_guest') {
          speakerLabel = 'Terapeuta (convidado)';
        } else if (t.speaker === 'therapist') {
          speakerLabel = 'Terapeuta';
        } else if (t.speaker === 'client') {
          speakerLabel = 'Cliente';
        } else {
          speakerLabel = t.speaker || 'Desconhecido';
        }
        
        // Formatar hora
        const time = new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Retornar linha formatada
        return `[${time}] ${speakerLabel}: ${t.content || t.transcript}`;
      }).join('\n');
    } catch (error) {
      console.warn('Erro ao gerar texto consolidado de transcri├º├Áes:', error);
      return 'Erro ao processar transcri├º├Áes';
    }
  }
}

// Vers├úo est├ível restaurada
// Exportar como singleton
const whisperTranscriptionService = new WhisperTranscriptionService();
export default whisperTranscriptionService;
