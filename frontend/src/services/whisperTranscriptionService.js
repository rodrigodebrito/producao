/**
 * WhisperTranscriptionService
 * Serviço para gravar áudio, converter formatos e enviar para a API Whisper
 * Com detecção automática de silêncio e envio de chunks
 */
import { WHISPER_URL, API_URL } from '../config';

// Adicionar importação do AIContext para acessar funções
// import { useAIContext } from "../contexts/AIContext";

class WhisperTranscriptionService {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.audioStream = null;
    this.isRecording = false;
    
    // Determinar se estamos em produção ou desenvolvimento
    this.isProd = !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');
    const backendBaseUrl = this.isProd ? 'https://theraconnect-prd.onrender.com' : '';
    
    // ATUALIZADO: Usar URLs absolutas em produção para todos os endpoints
    this.apiEndpoint = this.isProd ? `${backendBaseUrl}/api/ai/whisper/transcribe` : '/api/ai/whisper/transcribe';
    this.transcriptEndpoint = 'https://theraconnect-prd.onrender.com/api/ai/transcript'; // Manter URL absoluta conforme solicitado
    this.allTranscriptsEndpoint = this.isProd ? `${backendBaseUrl}/api/ai/transcriptions/session` : '/api/ai/transcriptions/session';
    
    // NOVO: Endpoint para análise de tom/emoção
    this.emotionAnalysisEndpoint = this.isProd ? `${backendBaseUrl}/api/ai/emotion/analyze` : '/api/ai/emotion/analyze';
    
    // FIXADO: Flag para controlar se o serviço já foi inicializado
    this.serviceInitialized = false;
    
    // NOVO: Flag para controlar se a análise de emoção está habilitada
    this.emotionAnalysisEnabled = true;
    
    console.log(`Whisper: Serviço criado em ambiente ${this.isProd ? 'de produção' : 'de desenvolvimento'}`);
    console.log(`Whisper: Endpoint de transcrição: ${this.apiEndpoint}`);
    
    // Configuração de transcrição em chunks
    this.chunkCounter = 0;
    this.transcriptionHistory = [];
    this.chunkStartTime = 0;
    this.maxChunkDuration = 10000; // MODIFICADO: Reduzido de 15000 para 10000 (10 segundos por chunk)
    this.minChunkDuration = 1500;  // MODIFICADO: Reduzido de 3000 para 1500 (1.5 segundos mínimo)
    this.maxChunkTimer = null;
    this.transcriptionInProgress = false;
    
    // Detecção de silêncio
    this.silenceDetectionEnabled = true;
    this.silenceThreshold = -45; // em dB
    this.silenceDuration = 2000; // MODIFICADO: Reduzido de 3000 para 2000 (2 segundos de silêncio para processar)
    this.silenceStart = null;
    this.silenceTimer = null;
    this.audioContext = null;
    this.audioAnalyser = null;
    
    // Controle de reinício automático
    this.autoRestart = false;
    this.pausedForSilence = false;
    this.manualStopped = false;
    this.voiceDetectionInterval = null;
    this.consecutiveSilenceFrames = 0;
    
    // Configurações específicas para o reconhecimento de sessão
    this.sessionId = null;
    this.sessionChangeDetected = false;
    this.speakerRole = 'unknown'; // therapist, client, etc
    
    // Novo: Verificar aiContext mais frequentemente
    this.aiContext = null;
    this.aiContextCheckInterval = null;
    
    // NOVO: Processamento contínuo durante gravação
    this.continuousProcessingEnabled = true; // ADICIONADO: Flag para habilitar processamento contínuo
    this.continuousProcessingInterval = 8000; // ADICIONADO: Processar a cada 8 segundos mesmo sem silêncio
    this.continuousProcessingTimer = null; // ADICIONADO: Timer para processamento contínuo
    
    // Tentar inicializar automaticamente na criação
    this.initializeService();
  }
  
  /**
   * NOVO: Método público para inicializar completamente o serviço
   * Deve ser chamado quando o usuário entrar na sala
   */
  initializeService() {
    if (this.serviceInitialized) {
      console.log('Whisper: Serviço já inicializado anteriormente');
      return;
    }
    
    // Atualizar sessionId com o valor mais recente
    const latestSessionId = this.extractSessionId();
    if (latestSessionId !== this.sessionId) {
      this.updateSessionId(latestSessionId);
    }
    
    // Iniciar busca de transcrições de outros participantes
    this._startFetchingOtherTranscriptions();
    
    this.serviceInitialized = true;
    console.log(`Whisper: Serviço inicializado completamente - sessionId: ${this.sessionId}`);
  }
  
  /**
   * NOVO: Método público que combina inicialização e início de gravação
   * Para ser chamado quando o usuário clicar no botão do microfone
   */
  async startRecordingSession() {
    // Inicializar o serviço se ainda não foi feito
    if (!this.serviceInitialized) {
      this.initializeService();
    }
    
    // Iniciar gravação
    return await this.startRecording();
  }
  
  /**
   * NOVO: Configurar detecção de mudança de sessão
   * @private
   */
  _setupSessionChangeDetection() {
    // Detectar quando a página se torna visível (retorno após tab ou minimização)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const currentSessionId = this.extractSessionId();
        
        // Se o ID da sessão mudou enquanto a página estava invisível
        if (currentSessionId !== this.sessionId && currentSessionId) {
          console.log(`Whisper: Detectada mudança de sessão de ${this.sessionId} para ${currentSessionId}`);
          this.updateSessionId(currentSessionId);
          this._clearPreviousTranscriptions();
        }
        
        // Verificar se a sessão está inativa há muito tempo
        const inactiveTime = Date.now() - this.lastActivityTime;
        if (inactiveTime > 30 * 60 * 1000) { // 30 minutos
          console.log(`Whisper: Sessão inativa por ${Math.round(inactiveTime/60000)} minutos, limpando transcrições`);
          this._clearPreviousTranscriptions();
        }
        
        // Atualizar timestamp de atividade
        this.lastActivityTime = Date.now();
      }
    });
    
    // Detectar carregamento inicial da página
    window.addEventListener('load', () => {
      // Ao carregar a página, limpar transcrições antigas
      console.log('Whisper: Página carregada, limpando transcrições antigas');
      this._clearPreviousTranscriptions();
    });
    
    // Ouvir eventos específicos de inicialização de sessão do sistema
    window.addEventListener('session-started', (e) => {
      console.log('Whisper: Evento session-started recebido');
      this._clearPreviousTranscriptions();
      
      // Se o evento tiver um ID de sessão, usá-lo
      if (e.detail && e.detail.sessionId) {
        this.updateSessionId(e.detail.sessionId);
      }
    });
  }
  
  /**
   * NOVO: Limpa transcrições antigas no storage
   * @private
   */
  _cleanStaleTranscriptions() {
    console.log('Whisper: Verificando transcrições antigas...');
    
    try {
      const now = Date.now();
      const maxAge = 12 * 60 * 60 * 1000; // 12 horas
      const keysToCheck = [];
      
      // Coletar todas as chaves de transcrição no localStorage
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
                console.log(`Whisper: Removida transcrição antiga (${Math.round(age/3600000)}h): ${key}`);
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
      
      console.log(`Whisper: Verificação concluída. Removidas ${removedCount} transcrições antigas.`);
    } catch (e) {
      console.error('Whisper: Erro ao limpar transcrições antigas:', e);
    }
  }

  /**
   * Determina o papel do usuário (terapeuta ou cliente) com base na sessão atual
   * @returns {string} 'therapist' ou 'client'
   * @private
   */
  _determineSpeakerRole() {
    try {
      // Verificar se existe informação de usuário local
      const userData = localStorage.getItem('user') || sessionStorage.getItem('user');
      
      if (userData) {
        try {
          const user = JSON.parse(userData);
          
          // Se temos informação de role, usar diretamente
          if (user && user.role) {
            if (user.role === 'THERAPIST') return 'therapist';
            if (user.role === 'CLIENT') return 'client';
          }
          
          // Se temos informações como isTherapist ou tipo de usuário
          if (user && (user.isTherapist || user.userType === 'THERAPIST')) {
            return 'therapist';
          }
        } catch (e) {
          console.warn('Whisper: Erro ao parse de userData para determinar papel:', e);
        }
      }
      
      // Segundo método: verificar URL por indicadores de terapeuta/cliente
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
      console.error('Whisper: Erro ao determinar papel do usuário:', e);
      return 'unknown';
    }
  }

  /**
   * NOVO: Verifica se o usuário atual é o host (anfitrião/dono) da sessão
   * Isso é útil para diferenciar quando dois terapeutas estão em uma sessão
   * @returns {boolean} True se o usuário atual é o host da sessão
   * @private
   */
  _isSessionHost() {
    try {
      // 1. Verificar no AIContext se temos informação de host
      if (window.__AI_CONTEXT && typeof window.__AI_CONTEXT.isHost === 'boolean') {
        return window.__AI_CONTEXT.isHost;
      }
      
      // 2. Verificar se temos informação de sessão no sessionStorage
      const sessionData = sessionStorage.getItem(`session_${this.sessionId}`);
      if (sessionData) {
        try {
          const session = JSON.parse(sessionData);
          if (session && typeof session.isHost === 'boolean') {
            return session.isHost;
          }
          
          // Verificar se o usuário atual é o criador da sessão
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
          console.warn('Whisper: Erro ao analisar dados da sessão para determinar host:', e);
        }
      }
      
      // 3. Verificar se existe um elemento DOM com data-is-host
      const hostElement = document.querySelector('[data-is-host]');
      if (hostElement) {
        const isHostAttr = hostElement.getAttribute('data-is-host');
        if (isHostAttr === 'true') return true;
        if (isHostAttr === 'false') return false;
      }
      
      // 4. Para terapeutas: assumir que são host por padrão
      if (this.speakerRole === 'therapist') {
        console.log('Whisper: Usuário é terapeuta, assumindo que é host por padrão');
        return true;
      }
      
      // 5. Para clientes: assumir que não são host por padrão
      if (this.speakerRole === 'client') {
        return false;
      }
      
      // Fallback: se não conseguimos determinar, assumir false
      return false;
    } catch (e) {
      console.error('Whisper: Erro ao determinar status de host:', e);
      return false;
    }
  }
  
  /**
   * NOVO: Determina o identificador do papel com base no papel do usuário e status de host
   * Útil para quando dois terapeutas estão na mesma sessão
   * @returns {string} Identificador do papel (therapist_host, therapist_guest, client)
   * @private
   */
  _getSpeakerIdentifier() {
    const role = this.speakerRole;
    const isHost = this._isSessionHost();
    
    // Caso especial: dois terapeutas na mesma sessão
    if (role === 'therapist') {
      return isHost ? 'therapist_host' : 'therapist_guest';
    }
    
    // Para clientes, manter identificação simples
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
   * Atualiza o ID da sessão atual
   * @param {string} newSessionId - Novo ID de sessão
   */
  updateSessionId(newSessionId) {
    if (!newSessionId) return;
    
    // Se o ID está mudando, limpar as transcrições antigas
    if (this.sessionId && this.sessionId !== newSessionId) {
      this._clearPreviousTranscriptions();
    }
    
    console.log(`Whisper: Atualizando sessionId de "${this.sessionId}" para "${newSessionId}"`);
    this.sessionId = newSessionId;
    
    // Atualizar informações de sessão
    this.sessionStartTime = Date.now();
    this.lastActivityTime = Date.now();
    this.sessionLogicalId = `${this.sessionId}_${this.sessionStartTime}`;
    
    // Salvar também no storage para consistência
    try {
      localStorage.setItem('currentSessionId', newSessionId);
      sessionStorage.setItem('currentSessionId', newSessionId); 
    } catch (e) {
      console.warn('Erro ao salvar sessionId no storage:', e);
    }
  }
  
  /**
   * NOVO: Método público para limpar manualmente as transcrições
   * Pode ser chamado pelo código cliente quando necessário
   */
  clearTranscriptions() {
    console.log('Whisper: Limpeza manual de transcrições solicitada');
    return this._clearPreviousTranscriptions();
  }

  /**
   * Limpa transcrições antigas quando uma nova sessão é iniciada
   * @private
   */
  _clearPreviousTranscriptions() {
    console.log('Whisper: Limpando transcrições de sessões anteriores');
    
    try {
      // 1. Limpar o histórico na memória
      this.transcriptionHistory = [];
      
      // 2. Remover transcrições antigas dessa sessão do sessionStorage
      if (this.sessionId) {
        sessionStorage.removeItem(`whisper_transcriptions_${this.sessionId}`);
        sessionStorage.removeItem(`last_transcript_${this.sessionId}`);
        console.log(`Whisper: Removido dados da sessão anterior ${this.sessionId} do sessionStorage`);
      }
      
      // 3. Remover transcrições antigas dessa sessão do localStorage
      if (this.sessionId) {
        localStorage.removeItem(`whisper_transcript_${this.sessionId}`);
        console.log(`Whisper: Removido dados da sessão anterior ${this.sessionId} do localStorage`);
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
      
      console.log('Whisper: Limpeza de transcrições antigas concluída');
      return true;
    } catch (e) {
      console.error('Whisper: Erro ao limpar transcrições antigas:', e);
      return false;
    }
  }

  /**
   * Iniciar a gravação de áudio e configurar detecção de silêncio
   * @returns {Promise<boolean>} - Sucesso da inicialização da gravação
   */
  async startRecording() {
    try {
      // FIXADO: Verificar se o serviço foi inicializado, se não, inicializá-lo
      if (!this.serviceInitialized) {
        console.log('Whisper: Serviço não inicializado, inicializando agora...');
        this.initializeService();
      }
      
      console.log('=== INICIANDO NOVA GRAVAÇÃO WAV ===');
      
      // NOVO: Atualizar timestamp de atividade
      this.lastActivityTime = Date.now();
      
      // Garantir que temos o sessionId mais atualizado
      const latestSessionId = this.extractSessionId();
      if (latestSessionId !== this.sessionId) {
        this.updateSessionId(latestSessionId);
      }
      
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
      
      // 5. Verificar sessionId válido
      if (!this.sessionId || this.sessionId.startsWith('temp_') || this.sessionId.startsWith('error_')) {
        const newId = this.extractSessionId();
        if (newId && !newId.startsWith('temp_') && !newId.startsWith('error_')) {
          this.updateSessionId(newId);
        }
        console.log(`Usando sessionId: ${this.sessionId}`);
      }
      
      // 6. Solicitar permissão do microfone local
      console.log('Solicitando permissão de microfone local...');
      this.audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      console.log('Permissão de microfone concedida, criando novo MediaRecorder');
      
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
      
      console.log(`Formato de gravação selecionado: ${mimeType || 'padrão do navegador'}`);
      
      // 8. Configurar opções avançadas para MediaRecorder
      const options = mimeType ? {
        mimeType,
        audioBitsPerSecond: 128000 // Qualidade mais baixa para evitar problemas
      } : undefined;
      
      // 9. Criar nova instância do MediaRecorder
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
        this._dispatchEvent('recordingError', { error: 'Erro na gravação de áudio' });
      };
      
      // 12. Iniciar gravação com chunks MUITO pequenos para melhor controle
      this.mediaRecorder.start(300); // 300ms por chunk para maior controle
      console.log('Gravação WAV iniciada com nova instância de MediaRecorder');
      
      // 13. Configurar detecção de silêncio
      if (this.silenceDetectionEnabled) {
        this._setupSilenceDetection(this.audioStream);
      }
      
      // 14. Configurar timer para chunk máximo
      this._setupMaxChunkTimer();
      
      // 15. Disparar evento de início
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
   * Configurar timer para chunk máximo
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
    
    // ADICIONADO: Configurar timer para processamento contínuo
    if (this.continuousProcessingEnabled) {
      if (this.continuousProcessingTimer) {
        clearTimeout(this.continuousProcessingTimer);
      }
      
      this.continuousProcessingTimer = setTimeout(() => {
        console.log(`Processamento contínuo ativado após ${this.continuousProcessingInterval/1000}s de gravação`);
        
        // Verificar se temos dados suficientes
        if (this.audioChunks && this.audioChunks.length > 0) {
          const duration = Date.now() - this.chunkStartTime;
          if (duration >= this.minChunkDuration) {
            // Clonar os chunks atuais para não perder dados
            const chunksToProcess = [...this.audioChunks];
            
            // Criar blob desses chunks
            const audioBlob = new Blob(chunksToProcess, { type: 'audio/wav' });
            
            // Processar apenas se o tamanho for suficiente
            if (audioBlob.size >= 1024) {
              console.log(`Processamento contínuo: enviando ${Math.round(audioBlob.size/1024)}KB para transcrição...`);
              
              // Gerar nome de arquivo único
              const timestamp = Date.now();
              const randomId = Math.floor(Math.random() * 10000);
              const fileName = `continuous-${timestamp}-${randomId}.wav`;
              
              // Processar sem interromper a gravação atual
              this.processAudioChunks(audioBlob, fileName)
                .then(() => {
                  console.log('Processamento contínuo concluído, mantendo gravação ativa');
                  
                  // Configurar o próximo timer de processamento contínuo
                  this._setupContinuousProcessingTimer();
                })
                .catch(error => {
                  console.error('Erro no processamento contínuo:', error);
                  this._setupContinuousProcessingTimer();
                });
            } else {
              console.log('Processamento contínuo: blob muito pequeno, aguardando mais áudio');
              // Configurar o próximo timer mesmo assim
              this._setupContinuousProcessingTimer();
            }
          } else {
            console.log(`Processamento contínuo: duração atual (${Math.round(duration/1000)}s) menor que o mínimo, aguardando mais áudio`);
            // Configurar o próximo timer mesmo assim
            this._setupContinuousProcessingTimer();
          }
        } else {
          console.log('Processamento contínuo: sem chunks de áudio disponíveis');
          // Configurar o próximo timer mesmo assim
          this._setupContinuousProcessingTimer();
        }
      }, this.continuousProcessingInterval);
    }
  }
  
  /**
   * ADICIONADO: Configura o timer para processamento contínuo
   * @private
   */
  _setupContinuousProcessingTimer() {
    if (!this.continuousProcessingEnabled || !this.isRecording) return;
    
    if (this.continuousProcessingTimer) {
      clearTimeout(this.continuousProcessingTimer);
    }
    
    this.continuousProcessingTimer = setTimeout(() => {
      if (!this.isRecording) return;
      
      console.log('Timer de processamento contínuo acionado');
      
      // Verificar se temos dados suficientes
      if (this.audioChunks && this.audioChunks.length > 0) {
        const duration = Date.now() - this.chunkStartTime;
        if (duration >= this.minChunkDuration) {
          // Clonar os chunks atuais para não perder dados
          const chunksToProcess = [...this.audioChunks];
          
          // Criar blob desses chunks
          const audioBlob = new Blob(chunksToProcess, { type: 'audio/wav' });
          
          // Processar apenas se o tamanho for suficiente
          if (audioBlob.size >= 1024) {
            console.log(`Processamento contínuo: enviando ${Math.round(audioBlob.size/1024)}KB para transcrição...`);
            
            // Gerar nome de arquivo único
            const timestamp = Date.now();
            const randomId = Math.floor(Math.random() * 10000);
            const fileName = `continuous-${timestamp}-${randomId}.wav`;
            
            // Processar sem interromper a gravação atual
            this.processAudioChunks(audioBlob, fileName)
              .then(() => {
                console.log('Processamento contínuo concluído, mantendo gravação ativa');
                
                // Configurar o próximo timer de processamento contínuo
                this._setupContinuousProcessingTimer();
              })
              .catch(error => {
                console.error('Erro no processamento contínuo:', error);
                this._setupContinuousProcessingTimer();
              });
          } else {
            console.log('Processamento contínuo: blob muito pequeno, aguardando mais áudio');
            this._setupContinuousProcessingTimer();
          }
        } else {
          console.log(`Processamento contínuo: duração atual (${Math.round(duration/1000)}s) menor que o mínimo, aguardando mais áudio`);
          this._setupContinuousProcessingTimer();
        }
      } else {
        console.log('Processamento contínuo: sem chunks de áudio disponíveis');
        this._setupContinuousProcessingTimer();
      }
    }, this.continuousProcessingInterval);
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
   * @param {boolean} manualStop - Se a parada foi solicitada manualmente pelo usuário
   * @returns {Promise<void>}
   */
  async stopRecording(processCurrentChunk = true, manualStop = false) {
    console.log('=== PARANDO GRAVAÇÃO WAV ===');
    
    // Adicionar log explícito sobre o tipo de parada
    console.log(`Tipo de parada: ${manualStop ? 'MANUAL (por usuário)' : 'Automática (por sistema)'}`);
    
    // Marcar se a parada foi manual (de forma mais explícita)
    this.manualStopped = manualStop === true;
    
    // NOVO: Se for parada manual, desativar explicitamente o autoRestart
    if (manualStop) {
      console.log('🛑 Desativando autoRestart devido a parada manual');
      this.autoRestart = false;
    }
    
    // Se for parada manual, desativar completamente o detector de voz
    if (manualStop) {
      console.log('PARADA MANUAL detectada - desativando detecção de voz e reinício automático');
      this.pausedForSilence = false; // Não estamos em pausa, estamos completamente parados
      
      // Certificar-se de que a detecção de voz seja interrompida
      if (this.voiceDetectionInterval) {
        clearInterval(this.voiceDetectionInterval);
        this.voiceDetectionInterval = null;
      }
    }
    
    // Forçar liberação de recursos mesmo que o MediaRecorder não esteja ativo
    const wasRecording = this.isRecording;
    
    // Imediatamente marcar como não gravando para evitar loops
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
      
      // Notificar que a gravação foi interrompida
      this._dispatchEvent('recordingStopped', { isRecording: false });
      return;
    }
    
    try {
      // 1. Capturar referência aos chunks antes de limpar
      const finalAudioChunks = [...this.audioChunks];
      
      // 2. Parar gravação com segurança
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        try {
          await new Promise((resolve) => {
            // Definir um timeout curto para garantir que continue mesmo se o stop() travar
            const stopTimeout = setTimeout(() => {
              console.warn('Timeout ao parar gravação, forçando liberação');
              resolve();
            }, 1000); // Reduzido para 1 segundo para resposta mais rápida
            
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
      
      // 3. Liberar TODOS os recursos de áudio com força máxima
      await this._forceReleaseAudioResources();
      
      // 4. Notificar que a gravação foi interrompida
      this._dispatchEvent('recordingStopped', { isRecording: false });
      
      // 5. Processar o áudio capturado se solicitado e se houver dados
      if (wasRecording && processCurrentChunk && finalAudioChunks.length > 0) {
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
      
      // Garantir limpeza mesmo em caso de erro
      await this._forceReleaseAudioResources();
    }
  }
  
  /**
   * Força a liberação de recursos de áudio, mesmo em caso de erros
   * @private
   */
  async _forceReleaseAudioResources() {
    console.log('⚠️ FORÇANDO LIBERAÇÃO DE TODOS OS RECURSOS DE ÁUDIO ⚠️');
    
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
            console.warn('Erro ao forçar parada do MediaRecorder:', e);
          }
        }
        
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
    
    // 4. Limpar todos os temporizadores possíveis
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
    
    // 6. Tenta forçar garbage collection
    if (window.gc) {
      try {
        window.gc();
      } catch (e) {}
    }
    
    // 7. Esperar um momento para garantir que tudo foi limpo
    await new Promise(resolve => setTimeout(resolve, 200));
    
    console.log('🧹 Liberação forçada de recursos completa');
  }

  /**
   * Processa os chunks de áudio e os envia para o servidor
   * @param {Blob} audioBlob - O blob de áudio a ser processado
   * @param {string} fileName - O nome do arquivo
   * @returns {Promise<void>}
   */
  async processAudioChunks(audioBlob, fileName) {
    try {
      // Gerar um ID único para este processamento
      const processingId = `proc_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      
      // 1. Verificar se temos um blob válido
      if (!audioBlob || audioBlob.size === 0) {
        throw new Error('Arquivo de áudio vazio ou inválido');
      }
      
      // NOVO: Se análise de emoção estiver ativada, fazer a análise em paralelo com a transcrição
      let emotionAnalysisPromise = Promise.resolve(null);
      if (this.emotionAnalysisEnabled || this.toneAnalysisEnabled) {
        console.log('Iniciando análise de emoção/tom em paralelo com a transcrição');
        emotionAnalysisPromise = this._analyzeEmotionInAudio(audioBlob, processingId);
      }
      
      // 2. Adicionar flag para acompanhar se é o primeiro áudio
      const isFirstAudio = this.chunkCounter === 0;
      
      // 3. Verificar tipo MIME e preparar para upload
      const mimeType = audioBlob.type || 'audio/wav';
      
      // 4. Definir nome do arquivo para upload se não foi fornecido
      const finalFileName = fileName || `audio_${Date.now()}.wav`;
      
      // 5. Usar o blob diretamente (já deve estar no formato correto)
      const blobToSend = audioBlob;
      
      console.log(`Enviando áudio como WEBM: ${finalFileName}, tamanho: ${Math.round(blobToSend.size/1024)}KB`);
      
      // 6. Disparar evento de processamento
      this._dispatchEvent('processingChunk', {
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
      
      // 8. Marcar como em progresso
      this.transcriptionInProgress = true;
      
      try {
        // 9. Enviar para a API Whisper
        console.log(`Enviando áudio para transcrição via XHR: ${finalFileName}`);
        const response = await this._sendAudioWithXHR(blobToSend, finalFileName);
        
        // 10. Processar resultado
        console.log('Processando resposta da API Whisper');
        
        // NOVO: Aguardar resultado da análise de emoção se estiver ativa
        const emotionAnalysis = await emotionAnalysisPromise;
        
        // Adicionar informações de emoção à resposta da API antes de processar
        if (emotionAnalysis && response && response.data) {
          console.log('Combinando análise de emoção/tom com resultado da transcrição');
          response.data.emotionAnalysis = emotionAnalysis.emotions || null;
          response.data.toneAnalysis = emotionAnalysis.tones || null;
        }
        
        const result = await this._processResponse(response);
        
        // 11. Incrementar contador de chunks
        this.chunkCounter++;
        
        // 12. Retornar o resultado
        return result;
      } finally {
        // 13. Liberar flag de progresso
        this.transcriptionInProgress = false;
        
        // 14. Disparar evento de conclusão
        this._dispatchEvent('transcriptionComplete', {
          success: true,
          chunkCounter: this.chunkCounter
        });
      }
    } catch (error) {
      console.error('Erro ao processar chunks de áudio:', error);
      this._dispatchEvent('processingError', { error: error.message });
      throw error;
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
      
      // Reiniciar gravação após pequeno intervalo
      console.log("Aguardando 2 segundos antes de reiniciar gravação...");
      
      // Usar setTimeout para garantir que haja um atraso antes do reinício
      setTimeout(async () => {
        // VERIFICAR se foi parado manualmente - NÃO reiniciar se foi
        if (this.manualStopped) {
          console.log("🛑 NÃO reiniciando gravação pois foi parada manualmente pelo usuário");
          // Emitir um evento adicional para garantir que a UI sincronize
          this._dispatchEvent('manualStopConfirmed', { message: 'Gravação permanece parada conforme solicitado pelo usuário' });
          return; // Sair do setTimeout sem reiniciar
        }
        
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
    
    // Se desativar o reinício e estiver em pausa, cancelar detecção de voz
    if (!enable && this.pausedForSilence) {
      if (this.voiceDetectionInterval) {
        clearInterval(this.voiceDetectionInterval);
        this.voiceDetectionInterval = null;
      }
      this.pausedForSilence = false;
    }
    
    console.log(`Reinício automático ${enable ? 'ativado' : 'desativado'}`);
    this._dispatchEvent('statusChange', { 
      status: 'config', 
      autoRestart: enable,
      message: `Reinício automático ${enable ? 'ativado' : 'desativado'}`
    });
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
    
    // Se a parada foi manual, não reiniciar
    if (this.manualStopped) {
      console.log('Não iniciando detecção de voz pois gravação foi parada manualmente');
      return;
    }
    
    try {
      // Marcar como pausado por silêncio
      this.pausedForSilence = true;
      
      // Parar a gravação sem processar o áudio (já foi processado)
      await this.stopRecording(false);
      
      // Iniciar detecção de voz para retomar gravação apenas se autoRestart estiver ativo
      if (this.autoRestart) {
        this._startVoiceDetection();
        console.log('Gravação pausada por silêncio. Aguardando voz para reiniciar...');
      } else {
        console.log('Gravação pausada por silêncio. Reinício automático desativado.');
      }
    } catch (error) {
      console.error('Erro ao pausar gravação por silêncio:', error);
    }
  }
  
  /**
   * NOVO: Inicia detecção de voz após pausa por silêncio
   * @private
   */
  _startVoiceDetection() {
    // Se a parada foi manual, não iniciar detecção
    if (this.manualStopped) {
      console.log('Não iniciando detecção de voz pois gravação foi parada manualmente');
      return;
    }
    
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
      
      // NOVO: Adicionar análise de emoção se disponível o blob de áudio
      let emotionAnalysis = null;
      let toneAnalysis = null;
      
      if (audioBlob && this.emotionAnalysisEnabled) {
        console.log('Whisper: Iniciando análise de emoções no áudio transcrito');
        try {
          const analysisResult = await this._analyzeEmotions(audioBlob);
          
          if (analysisResult && analysisResult.emotions) {
            emotionAnalysis = analysisResult.emotions;
            console.log('Whisper: Análise de emoções concluída com sucesso!');
            console.log('Emotions:', JSON.stringify(emotionAnalysis, null, 2));
          }
          
          if (analysisResult && analysisResult.tones) {
            toneAnalysis = analysisResult.tones;
            console.log('Whisper: Análise de tom concluída com sucesso!');
            console.log('Tones:', JSON.stringify(toneAnalysis, null, 2));
          }
        } catch (emotionError) {
          console.error('Whisper: Erro na análise de emoções:', emotionError);
        }
      } else if (!audioBlob) {
        console.log('Whisper: Blob de áudio não disponível para análise de emoções');
      } else if (!this.emotionAnalysisEnabled) {
        console.log('Whisper: Análise de emoção desabilitada nas configurações');
      }
      
      // NOVO: Extrair informações de emoção/tom se disponíveis na resposta
      emotionAnalysis = emotionAnalysis || response.data.emotionAnalysis || null;
      toneAnalysis = toneAnalysis || response.data.toneAnalysis || null;
      
      // Obter identificador completo do papel (inclui status de host)
      const speakerIdentifier = this._getSpeakerIdentifier();
      const isHost = this._isSessionHost();
      
      // MELHORIA: Adicionar formatação melhorada para visualização no console
      // Mostrar claramente quem é o falante com distinção entre host e convidado
      let speakerLabel = this.speakerRole.toUpperCase();
      let bgColor = this.speakerRole === 'therapist' ? '#4CAF50' : '#2196F3';
      
      // Adicionar indicador de host para terapeutas
      if (this.speakerRole === 'therapist') {
        if (isHost) {
          speakerLabel = 'TERAPEUTA (ANFITRIÃO)';
          bgColor = '#4CAF50'; // Verde para terapeuta anfitrião
        } else {
          speakerLabel = 'TERAPEUTA (CONVIDADO)';
          bgColor = '#009688'; // Verde azulado para terapeuta convidado
        }
      } else if (this.speakerRole === 'client') {
        speakerLabel = 'CLIENTE';
      }
      
      // NOVO: Adicionar informação de emoção ao log, se disponível
      let emotionInfo = '';
      if (emotionAnalysis && emotionAnalysis.dominant) {
        emotionInfo = ` [Emoção: ${emotionAnalysis.dominant.label}]`;
      }
      
      let toneInfo = '';
      if (toneAnalysis && toneAnalysis.dominant) {
        toneInfo = ` [Tom: ${toneAnalysis.dominant.label}]`;
      }
      
      // Log detalhado das emoções detectadas
      console.log(`===== EMOÇÕES DETECTADAS PELO WHISPER =====`);
      console.log(`Sessão: ${this.sessionId}`);
      console.log(`Falante: ${speakerIdentifier}`);
      
      if (emotionAnalysis) {
        console.log(`Emoção dominante: ${emotionAnalysis.dominant?.label || 'não detectada'}`);
        if (emotionAnalysis.all && emotionAnalysis.all.length > 0) {
          console.log('Todas as emoções detectadas:');
          emotionAnalysis.all.forEach(emotion => {
            console.log(`- ${emotion.label}: ${emotion.confidence.toFixed(2)}`);
          });
        }
      } else {
        console.log('Nenhuma emoção detectada');
      }
      
      if (toneAnalysis) {
        console.log(`Tom dominante: ${toneAnalysis.dominant?.label || 'não detectado'}`);
      }
      console.log(`==========================================`);
      
      console.log(
        `\n%c ${speakerLabel} DISSE${emotionInfo}${toneInfo}: %c ${transcription.substring(0, 200)}${transcription.length > 200 ? '...' : ''}\n`, 
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
      
      // Log adicional da sessão para rastreamento
      console.log(
        `%c SESSÃO: %c ${this.sessionId} %c PAPEL: %c ${speakerIdentifier} %c TIMESTAMP: %c ${new Date().toLocaleTimeString()}`, 
        'font-weight: bold; color: #9E9E9E;', 
        'color: #9E9E9E;',
        'font-weight: bold; color: #9E9E9E;', 
        'color: #9E9E9E;',
        'font-weight: bold; color: #9E9E9E;', 
        'color: #9E9E9E;'
      );
      
      // Validar transcrição
      if (!transcription || transcription.trim().length === 0) {
        console.warn('Transcrição vazia recebida, ignorando...');
        return false;
      }
      
      // Formato para envio para o AI Context
      const transcriptionData = {
        sessionId: this.sessionId,
        speaker: this.speakerRole,
        speakerIdentifier: speakerIdentifier, // Novo campo com identificador completo
        isHost: isHost, // Novo campo indicando se é o anfitrião
        content: transcription.trim(),
        timestamp: new Date().toISOString(),
        // NOVO: Adicionar informações de emoção/tom aos dados da transcrição
        emotionAnalysis: emotionAnalysis,
        toneAnalysis: toneAnalysis
      };
      
      console.log(`Processando transcrição para sessão ${this.sessionId} como ${this.speakerRole}`);
      
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
          
          // NOVO: Atualizar emoções no AIContext se disponível
          if (emotionAnalysis && emotionAnalysis.all && emotionAnalysis.all.length > 0) {
            console.log(`===== ATUALIZANDO EMOÇÕES NO AICONTEXT =====`);
            // Converter formato de emoções para o formato esperado pelo AIContext
            const emotionsForAI = {};
            
            emotionAnalysis.all.forEach(emotion => {
              emotionsForAI[emotion.label] = emotion.confidence;
            });
            
            console.log('Enviando dados de emoções para AIContext:', JSON.stringify(emotionsForAI, null, 2));
            
            // Disparar evento de emoção detectada para atualizar o AIContext
            const emotionEvent = new CustomEvent('emotion-detected', {
              detail: {
                emotion: emotionAnalysis.dominant?.label || 'neutral',
                word: transcriptionData.content.substring(0, 20) + '...',
                accumulated: emotionsForAI
              }
            });
            
            window.dispatchEvent(emotionEvent);
            console.log(`Evento emotion-detected disparado para AIContext com dados:`, emotionEvent.detail);
            console.log(`Momento do envio: ${new Date().toISOString()}`);
            console.log(`===========================================`);
            
            // Forçar atualização do estado de emoções no AIContext se disponível
            if (window.__AI_CONTEXT && typeof window.__AI_CONTEXT.updateEmotions === 'function') {
              window.__AI_CONTEXT.updateEmotions(emotionsForAI);
              console.log('Emoções atualizadas diretamente no AIContext via updateEmotions');
            }
          } else {
            console.log('Nenhuma emoção disponível para atualizar o AIContext');
          }
          
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
                length: transcriptionData.content.length,
                emotions: emotionAnalysis ? emotionAnalysis.all : null
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
   * Analisa emoções em áudio usando o endpoint de análise de emoção
   * @param {Blob} audioBlob - Áudio para análise
   * @returns {Promise<Object>} Resultado da análise
   * @private
   */
  async _analyzeEmotions(audioBlob) {
    console.log('[Whisper] Iniciando análise de emoções...');
    
    try {
      // Log para debugging
      console.log(`[Whisper] Analisando áudio: ${audioBlob.size} bytes, tipo: ${audioBlob.type}`);
      
      // Verificar token de autenticação
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('[Whisper] Token de autenticação ausente para análise de emoções');
        return null;
      }
      
      // Construir FormData para enviar o áudio
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      formData.append('detectEmotions', 'true');
      formData.append('detectTone', 'true');
      
      const endpoint = `${import.meta.env.VITE_API_URL}/ai/speech-to-text`;
      console.log(`[Whisper] Enviando áudio para análise de emoções: ${endpoint}`);
      
      // Enviar para a API para análise
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      
      if (!response.ok) {
        console.error(`[Whisper] Erro na análise de emoções: ${response.status} ${response.statusText}`);
        return null;
      }
      
      const data = await response.json();
      
      if (data.emotions || data.tone) {
        console.log('[Whisper] Emoções detectadas:', data.emotions);
        console.log('[Whisper] Tom detectado:', data.tone);
        
        return {
          emotions: data.emotions || {},
          tone: data.tone || {}
        };
      } else {
        console.log('[Whisper] Nenhuma emoção ou tom detectado na análise');
        return null;
      }
    } catch (error) {
      console.error('[Whisper] Erro ao analisar emoções:', error);
      return null;
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
        console.warn('Análise de emoção: Token de autenticação não encontrado');
        return null;
      }
      
      // Verificar se temos um endpoint para análise de emoção
      if (!this.emotionAnalysisEndpoint) {
        console.warn('Endpoint para análise de emoção não configurado');
        
        // Se o backend não suporta análise de emoção, podemos usar uma 
        // solução alternativa com web API local
        return this._performLocalEmotionAnalysis(audioBlob);
      }
      
      console.log(`Enviando áudio para análise de emoção/tom: ${processingId}`);
      
      // Criar FormData para envio
      const formData = new FormData();
      formData.append('audio', audioBlob, `emotion_${processingId}.wav`);
      formData.append('processingId', processingId);
      
      // Configurar opções específicas de análise
      if (this.emotionAnalysisEnabled) {
        formData.append('analyzeEmotion', 'true');
        formData.append('emotionModel', this.emotionAnalysisModel);
      }
      
      if (this.toneAnalysisEnabled) {
        formData.append('analyzeTone', 'true');
      }
      
      // Enviar para API de análise de emoção
      const response = await fetch(this.emotionAnalysisEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        body: formData
      });
      
      if (!response.ok) {
        // Se der erro, continuar sem a análise de emoção
        console.warn(`Erro ao analisar emoção: ${response.status} ${response.statusText}`);
        return null;
      }
      
      const result = await response.json();
      return result;
    } catch (error) {
      console.warn('Erro ao analisar emoção no áudio:', error);
      return null; // Continuar sem a análise de emoção em caso de erro
    }
  }

  // NOVO: Método para análise de emoção local (fallback se não houver API)
  async _performLocalEmotionAnalysis(audioBlob) {
    // Implementação de fallback simples baseada em características de áudio
    try {
      console.log('Realizando análise de emoção local (fallback)');
      
      // Criar um contexto de áudio
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Decodificar o blob de áudio
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Analisar características básicas de áudio
      const channelData = audioBuffer.getChannelData(0);
      
      // Calcular volume médio e variância (indicadores básicos de emoção)
      let sum = 0;
      let sumOfSquares = 0;
      
      for (let i = 0; i < channelData.length; i++) {
        sum += Math.abs(channelData[i]);
        sumOfSquares += channelData[i] * channelData[i];
      }
      
      const avgVolume = sum / channelData.length;
      const variance = sumOfSquares / channelData.length - (sum / channelData.length) ** 2;
      
      // Lógica simplificada para determinar emoção baseada em volume e variância
      let dominantEmotion = 'neutral';
      let dominantTone = 'neutral';
      let emotionConfidence = 0.5;
      let toneConfidence = 0.5;
      
      // Volume alto + alta variância geralmente indica excitação (felicidade ou raiva)
      if (avgVolume > 0.1 && variance > 0.01) {
        dominantEmotion = 'excited';
        emotionConfidence = Math.min(0.7, avgVolume * 5);
      } 
      // Volume baixo + baixa variância pode indicar calma ou tristeza
      else if (avgVolume < 0.05 && variance < 0.005) {
        dominantEmotion = 'calm';
        emotionConfidence = Math.min(0.6, (1 - avgVolume) * 3);
      }
      
      // Para o tom, usamos a mesma lógica simples
      if (variance > 0.01) {
        dominantTone = 'expressive';
        toneConfidence = Math.min(0.7, variance * 50);
      } else {
        dominantTone = 'monotone';
        toneConfidence = Math.min(0.6, (1 - variance) * 30);
      }
      
      // Construir resultado básico
      return {
        emotions: {
          dominant: {
            label: dominantEmotion,
            confidence: emotionConfidence
          },
          all: [
            { label: dominantEmotion, confidence: emotionConfidence },
            { label: 'neutral', confidence: 1 - emotionConfidence }
          ]
        },
        tones: {
          dominant: {
            label: dominantTone,
            confidence: toneConfidence
          },
          all: [
            { label: dominantTone, confidence: toneConfidence },
            { label: 'neutral', confidence: 1 - toneConfidence }
          ]
        },
        audioFeatures: {
          averageVolume: avgVolume,
          variance: variance
        }
      };
    } catch (error) {
      console.error('Erro na análise local de emoção:', error);
      return null;
    }
  }

  // Novo método para atualizar emoções no AIContext
  _updateAIContextEmotions(emotions) {
    console.log('[Whisper] Tentando atualizar AIContext com emoções:', emotions);
    
    try {
      // Verificar se temos acesso direto ao contexto
      if (this.aiContext && typeof this.aiContext.updateEmotions === 'function') {
        console.log('[Whisper] Usando updateEmotions do aiContext');
        this.aiContext.updateEmotions(emotions);
        return;
      }
      
      // Alternativa: Disparar evento para atualizar o contexto
      console.log('[Whisper] Disparando evento updateEmotions');
      var emotionEvent = new CustomEvent('updateEmotions', { 
        detail: { emotions },
        bubbles: true,
        cancelable: true
      });
      window.dispatchEvent(emotionEvent);
      
    } catch (error) {
      console.error('[Whisper] Erro ao atualizar emoções no AIContext:', error);
    }
  }
}

// Versão estável restaurada
// Exportar como singleton
const whisperTranscriptionService = new WhisperTranscriptionService();
export default whisperTranscriptionService;