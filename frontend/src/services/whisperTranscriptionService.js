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
    
    // CORRIGIDO: Endpoint para análise de tom/emoção com URL absoluta em ambiente de produção
    this.emotionAnalysisEndpoint = this.isProd ? 
      `${backendBaseUrl}/api/ai/emotion/analyze` : 
      '/api/ai/emotion/analyze';
    
    // ADICIONADO: Endpoint alternativo para análise de texto
    this.analysisEndpoint = this.isProd ? 
      `${backendBaseUrl}/api/ai/analyze/text` : 
      '/api/ai/analyze/text';
    
    // FIXADO: Flag para controlar se o serviço já foi inicializado
    this.serviceInitialized = false;
    
    // NOVO: Flag para controlar se a análise de emoção está habilitada
    this.emotionAnalysisEnabled = true;
    
    console.log(`Whisper: Serviço criado em ambiente ${this.isProd ? 'de produção' : 'de desenvolvimento'}`);
    console.log(`Whisper: Endpoint de transcrição: ${this.apiEndpoint}`);
    console.log(`Whisper: Endpoint de análise de emoções: ${this.emotionAnalysisEndpoint}`);
    
    // Configuração de transcrição em chunks
    this.chunkCounter = 0;
    this.transcriptionHistory = [];
    this.chunkStartTime = 0;
    this.maxChunkDuration = 8000;   // MODIFICADO: Reduzido para 8 segundos por chunk
    this.minChunkDuration = 1000;   // MODIFICADO: Reduzido para 1 segundo mínimo
    this.maxChunkTimer = null;
    this.transcriptionInProgress = false;
    
    // Detecção de silêncio
    this.silenceDetectionEnabled = true;
    this.silenceThreshold = -45;    // em dB
    this.silenceDuration = 1500;    // MODIFICADO: Reduzido para 1.5 segundos de silêncio para processar
    this.silenceStart = null;
    this.silenceTimer = null;
    this.audioContext = null;
    this.audioAnalyser = null;
    
    // Controle de reinício automático
    this.autoRestart = true;        // MODIFICADO: Habilitado por padrão
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
    this.continuousProcessingEnabled = true;   // Habilitado
    this.continuousProcessingInterval = 4000;  // MODIFICADO: Reduzido para 4 segundos
    this.continuousProcessingTimer = null;
    this.lastProcessedTime = 0;                // ADICIONADO: Para controlar quando foi o último processamento
    this.continuousProcessingStarted = false;  // ADICIONADO: Flag para controlar se o processamento contínuo já começou
    
    // ADICIONADO: Propriedades para busca de transcrições de outros participantes
    this.lastFetchTimestamp = null;
    this.transcriptionFetchInterval = null;
    this.otherParticipantsTranscriptions = [];
    
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
    
    // Iniciar detecção de mudança de sessão
    this._setupSessionChangeDetection();
    
    // Determinar o papel do usuário
    if (!this.speakerRole || this.speakerRole === 'unknown') {
      this.speakerRole = this._determineSpeakerRole();
      console.log(`Whisper: Papel do usuário determinado: ${this.speakerRole}`);
    }
    
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
      this.lastProcessedTime = Date.now();  // ADICIONADO: Inicializar o timestamp de último processamento
      this.continuousProcessingStarted = false; // ADICIONADO: Resetar flag de processamento contínuo
      
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
          
          // ADICIONADO: Iniciar o processamento contínuo após acumular alguns dados
          // Esta é uma melhoria para garantir que o processamento contínuo sempre começa
          if (!this.continuousProcessingStarted && this.audioChunks.length >= 3) {
            this.continuousProcessingStarted = true;
            console.log("Iniciando processamento contínuo após acumular dados iniciais");
            this._setupContinuousProcessingTimer();
          }
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
    
    const timeSinceLastProcess = Date.now() - this.lastProcessedTime;
    // Se o último processamento foi recente, aguardar um pouco mais
    const adjustedInterval = timeSinceLastProcess < 2000 
      ? this.continuousProcessingInterval + 2000 
      : this.continuousProcessingInterval;
    
    console.log(`Configurando próximo processamento contínuo para daqui a ${adjustedInterval/1000} segundos`);
    
    this.continuousProcessingTimer = setTimeout(() => {
      if (!this.isRecording) return;
      
      console.log('Timer de processamento contínuo acionado');
      this.lastProcessedTime = Date.now(); // ADICIONADO: Atualizar timestamp de último processamento
      
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
    }, adjustedInterval); // MODIFICADO: Usa o intervalo ajustado
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
      if (!response) {
        console.error('Resposta nula ou indefinida recebida');
        const errorMessage = 'Erro: Resposta do servidor vazia ou inválida';
        this._dispatchEvent('transcriptionError', { error: errorMessage });
        throw new Error(errorMessage);
      }
      
      // Se response não é HTTP Response (pode ser objeto direto)
      if (!response.ok && !response.json && typeof response !== 'object') {
        console.error('Formato de resposta inválido:', response);
        const errorMessage = 'Erro: Formato de resposta inválido';
        this._dispatchEvent('transcriptionError', { error: errorMessage });
        throw new Error(errorMessage);
      }
      
      // Se for uma resposta HTTP com erro
      if (response.ok === false) {
        let errorText = 'Erro desconhecido';
        try {
          // Tentar obter mensagens de erro detalhadas
          if (response.json) {
            try {
              const errorData = await response.json();
              errorText = errorData.message || errorData.error || response.statusText || 'Erro desconhecido';
            } catch (e) {
              // Se não conseguir como JSON, tentar como texto
              try {
                errorText = await response.text();
              } catch (textError) {
                errorText = `Erro HTTP ${response.status || 'desconhecido'}`;
              }
            }
          } else if (typeof response.statusText === 'string') {
            errorText = response.statusText;
          }
        } catch (e) {
          errorText = `Erro HTTP ${response.status || 'desconhecido'}`;
        }

        // Garantir que temos um texto de erro, mesmo que seja genérico
        if (!errorText || errorText === 'undefined') {
          errorText = `Erro ${response.status || 'desconhecido'}`;
        }

        console.error(`Erro na resposta do servidor (${response.status}): ${errorText}`);
        this._dispatchEvent('transcriptionError', { error: errorText });
        throw new Error(errorText);
      }

      // Processar a resposta JSON ou objeto direto
      let data;
      
      // Verificar se é um mock de resposta XHR ou resposta direta
      if (response.data) {
        // Se já é um objeto de dados (do XHR)
        data = response.data;
      } else if (response.json && typeof response.json === 'function') {
        // Se é uma resposta HTTP com JSON
        try {
          data = await response.json();
        } catch (jsonError) {
          console.error('Erro ao parsear JSON da resposta:', jsonError);
          const errorMessage = 'Erro ao processar resposta JSON do servidor';
          this._dispatchEvent('transcriptionError', { error: errorMessage });
          throw new Error(errorMessage);
        }
      } else if (typeof response === 'object') {
        // Se já é um objeto direto
        data = response;
      } else {
        // Fallback para qualquer outro formato
        try {
          data = JSON.parse(response.toString());
        } catch (e) {
          data = { text: response.toString() };
        }
      }
      
      // Validar os dados
      if (!data) {
        const errorMessage = 'Resposta vazia do servidor';
        console.error(errorMessage);
        this._dispatchEvent('transcriptionError', { error: errorMessage });
        throw new Error(errorMessage);
      }

      // Verificar formatação da resposta
      const text = data.text || data.transcript || data.content || data.result || 
                  (data.data ? data.data.text || data.data.transcript || data.data.content : null);
      
      // Se não encontramos texto na resposta, mas temos algum dado
      // tentar verificar se o dado em si é uma string (resposta direta)
      let finalData = data;
      if (!text) {
        if (typeof data === 'string') {
          finalData = { text: data };
        } else if (data.data && typeof data.data === 'string') {
          finalData = { text: data.data };
        } else {
          // Verificar se temos qualquer propriedade que seja string para usar como texto
          let foundTextProperty = false;
          for (const key in data) {
            if (typeof data[key] === 'string' && data[key].length > 5) {
              finalData = { text: data[key] };
              console.log(`Usando propriedade "${key}" como texto da transcrição:`, finalData.text.substring(0, 50));
              foundTextProperty = true;
              break;
            }
          }
          
          // Se não encontramos nenhuma propriedade de texto, lançar erro
          if (!foundTextProperty) {
            const errorMessage = 'Resposta não contém texto transcrito';
            console.warn('Resposta sem texto identificável:', data);
            this._dispatchEvent('transcriptionError', { error: errorMessage });
            throw new Error(errorMessage);
          }
        }
      }

      // Processar a transcrição
      return await this._processTranscription(finalData, null);
    } catch (error) {
      console.error('Erro ao processar resposta:', error);
      
      // Garantir que temos uma mensagem de erro não-vazia
      const errorMessage = error.message || 'Erro desconhecido';
      
      // Disparar evento de erro para notificar outros componentes
      this._dispatchEvent('transcriptionError', { error: errorMessage });
      
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
   * Processa e analisa a transcrição
   * @param {object} data - Dados da transcrição
   * @param {File|Blob} audioFile - Arquivo de áudio (opcional)
   * @returns {Promise<object>} - Dados processados
   * @private
   */
  async _processTranscription(data, audioFile) {
    try {
      // Extrair texto da resposta ou usar mensagem padrão
      const text = data.text || data.transcript || 'Nenhum texto transcrito';
      
      // Verificar se temos um texto válido para processar
      if (!text || text.trim().length === 0) {
        console.warn('Texto transcrito vazio, não processando');
        return null;
      }
      
      // Construir objeto de transcrição
      const transcript = {
        text: text,
        id: generateId(),
        timestamp: new Date().toISOString(),
        audioFile: audioFile,
        language: data.language || 'pt-br'
      };

      // Analisar sentimentos e emoções no texto
      let emotions = null;
      try {
        // Verificar se análise de emoções está habilitada
        if (this.emotionAnalysisEnabled) {
          emotions = await this._analyzeEmotions(text);
          if (emotions) {
            transcript.emotions = emotions;
          }
        } else {
          console.log('Análise de emoções desabilitada, pulando esta etapa');
        }
      } catch (emotionError) {
        console.warn('Erro ao analisar emoções:', emotionError);
        // Fornecer valores padrão para não interromper o fluxo
        transcript.emotions = {
          dominant: 'neutral',
          sentiment: 'neutral',
          scores: {
            neutral: 1.0,
            positive: 0,
            negative: 0
          },
          error: emotionError.message
        };
      }

      // Disparar evento de sucesso
      this._dispatchEvent('transcriptionSuccess', transcript);
      
      return transcript;
    } catch (error) {
      console.error('Erro ao processar transcrição:', error);
      // Propagar o erro para ser tratado pelo método chamador
      throw error;
    }
  }

  /**
   * Analisa emoções no texto transcrito
   * @param {string} text - Texto para análise
   * @returns {Promise<object>} - Análise de emoções
   * @private
   */
  async _analyzeEmotions(text) {
    if (!text || typeof text !== 'string' || text.trim().length < 5) {
      console.warn('Texto insuficiente para análise de emoções');
      return null;
    }

    try {
      // Usar o endpoint de análise de emoções do backend ou retornar valores padrão
      // Removido endpoint api.emocoes.ai que não está mais disponível
      if (!this.emotionAnalysisEndpoint) {
        console.log('Endpoint de análise de emoções não configurado, retornando valores padrão');
        return {
          dominant: 'neutral',
          sentiment: 'neutral',
          scores: {
            neutral: 1.0,
            positive: 0,
            negative: 0
          }
        };
      }
      
      // Obter token de autenticação
      const authToken = localStorage.getItem('authToken') || 
                      sessionStorage.getItem('authToken') || 
                      localStorage.getItem('token') || 
                      sessionStorage.getItem('token');
      
      if (!authToken) {
        console.warn('Token de autenticação não encontrado para análise de emoções');
        return {
          dominant: 'neutral',
          sentiment: 'neutral',
          scores: {
            neutral: 1.0,
            positive: 0,
            negative: 0
          }
        };
      }
      
      // Limitar o texto para evitar problemas com APIs
      const limitedText = text.substring(0, 500);
      
      // Fazer a requisição para a API de análise de emoções do backend
      const response = await fetch(this.emotionAnalysisEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ text: limitedText }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro na análise de emoções: ${response.status} - ${errorText}`);
      }

      const emotionData = await response.json();
      
      // Formatar e normalizar os resultados
      const emotions = {
        dominant: emotionData.dominant || emotionData.sentiment || null,
        scores: emotionData.scores || emotionData.emotions || emotionData.analysis || {},
        sentiment: emotionData.sentiment || emotionData.overallSentiment || null,
        confidence: emotionData.confidence || null,
        language: emotionData.language || 'pt'
      };

      console.log('Análise de emoções concluída:', emotions);
      return emotions;
    } catch (error) {
      console.error('Falha na análise de emoções:', error);
      // Evitar que a falha na análise de emoções interrompa o fluxo principal
      return {
        error: error.message,
        dominant: 'neutral',
        sentiment: 'neutral',
        scores: {
          neutral: 1.0,
          positive: 0,
          negative: 0
        }
      };
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
        console.warn('Token de autenticação não encontrado para envio de transcrição');
        return { success: false, error: 'Token de autenticação não encontrado' };
      }
      
      // Obter o ID da sessão do objeto data ou da propriedade do serviço
      const sessionId = data.sessionId || this.sessionId;
      
      // Verificar se temos um ID de sessão válido
      if (!sessionId || sessionId === 'unknown') {
        console.warn('ID de sessão não encontrado para envio de transcrição');
        return { success: false, error: 'ID de sessão não encontrado' };
      }
      
      // Atualizar o objeto data com o sessionId
      const transcriptionData = { ...data, sessionId };
      
      // CORREÇÃO: Adicionar campo 'transcript' para compatibilidade com o backend
      // O backend espera um campo 'transcript' ou 'content'
      if (transcriptionData.content && !transcriptionData.transcript) {
        transcriptionData.transcript = transcriptionData.content;
      }
      
      // Enviar para API
      console.log(`Enviando transcrição para backend: ${this.transcriptEndpoint}`);
      const response = await fetch(this.transcriptEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(transcriptionData)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Erro ao enviar transcrição: ${response.status} - ${errorText}`);
        return { 
          success: false, 
          error: `Erro ${response.status}: ${errorText}`
        };
      }
      
      const result = await response.json();
      console.log('Transcrição enviada com sucesso para o backend:', result);
      return result;
    } catch (error) {
      console.error('Erro ao enviar transcrição para o backend:', error);
      return { 
        success: false, 
        error: error.message || 'Erro desconhecido' 
      };
    }
  }

  /**
   * NOVO: Analisa emoções em áudio
   * @param {Blob} audioBlob - Blob de áudio
   * @param {string} processingId - ID para rastreamento
   * @returns {Promise<Object>} Resultado da análise
   * @private
   */
  async _analyzeEmotionInAudio(audioBlob, processingId) {
    try {
      // Log para debugging
      console.log(`Iniciando análise de emoção para processamento ${processingId}`);
      
      // Verificar token de autenticação
      const authToken = localStorage.getItem('authToken') || 
                        sessionStorage.getItem('authToken') || 
                        localStorage.getItem('token') || 
                        sessionStorage.getItem('token');
      
      if (!authToken) {
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
        formData.append('emotionModel', this.emotionAnalysisModel || 'default');
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

  /**
   * NOVO: Determina se um texto contém duplicação com transcrições anteriores
   * @param {string} text - Texto a verificar 
   * @returns {boolean} - True se o texto contém duplicação significativa
   * @private
   */
  _hasSignificantDuplication(text) {
    // Não verificar transcrições muito curtas
    if (!text || text.length < 10) return false;

    // Se não há histórico para comparar, não há duplicação
    if (!this.transcriptionHistory || this.transcriptionHistory.length === 0) {
      return false;
    }

    // Verificar as 3 últimas transcrições
    const recentTranscriptions = this.transcriptionHistory
      .slice(-3)
      .map(t => t.content || '');

    for (const prevText of recentTranscriptions) {
      // Ignorar transcrições muito curtas
      if (prevText.length < 10) continue;

      // Calcular o maior trecho em comum
      let maxCommonLength = 0;
      
      // Verificar trechos comuns entre as duas strings
      for (let i = 0; i < prevText.length; i++) {
        for (let j = 0; j < text.length; j++) {
          let commonLength = 0;
          while (
            i + commonLength < prevText.length && 
            j + commonLength < text.length && 
            prevText[i + commonLength] === text[j + commonLength]
          ) {
            commonLength++;
          }
          maxCommonLength = Math.max(maxCommonLength, commonLength);
        }
      }

      // Se o texto atual tem mais de 70% em comum com uma transcrição anterior
      // e o trecho comum é maior que 20 caracteres, consideramos como duplicação
      const duplicationRatio = maxCommonLength / text.length;
      if (duplicationRatio > 0.7 && maxCommonLength > 20) {
        console.log(`Duplicação detectada (${Math.round(duplicationRatio * 100)}%): "${text.substring(0, 30)}..."`);
        return true;
      }
    }

    return false;
  }

  /**
   * Iniciar busca periódica de transcrições de outros participantes
   * @private
   */
  _startFetchingOtherTranscriptions() {
    // Verificar se temos sessionId válido
    if (!this.sessionId || this.sessionId === 'unknown') {
      console.log('Whisper: Não é possível buscar transcrições sem sessionId válido');
      return;
    }

    console.log(`Whisper: Configurando busca de transcrições para a sessão ${this.sessionId}`);
    
    // Limpar intervalo anterior se existir
    if (this.transcriptionFetchInterval) {
      clearInterval(this.transcriptionFetchInterval);
    }

    // Busca inicial imediata
    this._fetchOtherParticipantsTranscriptions();
    
    // Configurar busca periódica (a cada 5 segundos)
    this.transcriptionFetchInterval = setInterval(() => {
      this._fetchOtherParticipantsTranscriptions();
    }, 5000);
    
    console.log('Whisper: Sistema de busca de transcrições iniciado com sucesso');
  }

  /**
   * Busca transcrições de outros participantes da sessão
   * @private
   */
  async _fetchOtherParticipantsTranscriptions() {
    try {
      // Verificar se temos sessionId válido
      if (!this.sessionId || this.sessionId === 'unknown') {
        console.log('Whisper: SessionID inválido, cancelando busca de transcrições');
        return;
      }

      // Obter token de autenticação
      const token = localStorage.getItem('token') || 
                    sessionStorage.getItem('token') || 
                    localStorage.getItem('authToken') || 
                    sessionStorage.getItem('authToken');
      
      if (!token) {
        console.log('Whisper: Token de autenticação não encontrado para buscar transcrições');
        return;
      }

      // Verificar timestamp da última transcrição vista
      const lastTimestamp = this.lastFetchTimestamp || '1970-01-01T00:00:00.000Z';

      // Construir URL com query params - usar URL absoluta para maior compatibilidade
      const baseUrl = this.isProd ? 'https://theraconnect-prd.onrender.com' : '';
      const url = `${baseUrl}/api/ai/transcriptions/session/${this.sessionId}?since=${encodeURIComponent(lastTimestamp)}`;
      
      console.log(`Whisper: Buscando transcrições no endpoint: ${url}`);
      
      // Enviar requisição
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        // Tentar endpoint alternativo se o primário falhar
        if (response.status === 404) {
          console.log('Whisper: Endpoint primário não encontrado, tentando alternativo');
          
          const altUrl = `${baseUrl}/api/transcriptions/session/${this.sessionId}?since=${encodeURIComponent(lastTimestamp)}`;
          const altResponse = await fetch(altUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (altResponse.ok) {
            const altResult = await altResponse.json();
            this._processTranscriptionsFromOthers(altResult);
            return;
          }
        }
        
        throw new Error(`Erro ao buscar transcrições: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      this._processTranscriptionsFromOthers(result);
    } catch (error) {
      console.error('Whisper: Erro ao buscar transcrições de outros participantes:', error);
    }
  }
  
  /**
   * Processa transcrições recebidas de outros participantes
   * @param {Object} result - Resultado da API com as transcrições
   * @private
   */
  _processTranscriptionsFromOthers(result) {
    // Verificar se recebemos transcrições
    if (result && result.data && Array.isArray(result.data) && result.data.length > 0) {
      console.log(`Whisper: Recebidas ${result.data.length} novas transcrições`);
      
      // Filtrar apenas transcrições de outros participantes
      const otherTranscriptions = result.data.filter(t => 
        t.speaker !== this.speakerRole || 
        (t.speakerIdentifier && t.speakerIdentifier !== this._getSpeakerIdentifier())
      );

      if (otherTranscriptions.length > 0) {
        console.log(`Whisper: ${otherTranscriptions.length} transcrições de outros participantes`);
        
        // Atualizar lista de transcrições de outros participantes
        this.otherParticipantsTranscriptions = [
          ...this.otherParticipantsTranscriptions || [],
          ...otherTranscriptions
        ];

        // Atualizar timestamp da última busca
        const timestamps = otherTranscriptions.map(t => new Date(t.timestamp).getTime());
        const lastTime = Math.max(...timestamps);
        this.lastFetchTimestamp = new Date(lastTime).toISOString();

        // Disparar evento para notificar novas transcrições
        this._dispatchEvent('otherTranscriptionsReceived', {
          transcriptions: otherTranscriptions
        });
        
        console.log('Whisper: Novas transcrições processadas e evento disparado');
      } else {
        console.log('Whisper: Nenhuma transcrição de outros participantes entre as recebidas');
      }
    } else {
      console.log('Whisper: Nenhuma nova transcrição disponível');
    }
  }
  
  /**
   * Salva a transcrição no sessionStorage para recuperação posterior
   * @param {Object} transcriptionData - Dados da transcrição
   * @private
   */
  _saveTranscriptionToStorage(transcriptionData) {
    try {
      if (!transcriptionData || !transcriptionData.sessionId) {
        console.warn('Dados de transcrição inválidos ou ausentes');
        return false;
      }
      
      // Criar uma chave única baseada na sessão
      const storageKey = `whisper_session_${transcriptionData.sessionId}`;
      
      // Recuperar dados existentes ou inicializar array vazio
      let sessionTranscriptions = [];
      const existingData = sessionStorage.getItem(storageKey);
      
      if (existingData) {
        try {
          sessionTranscriptions = JSON.parse(existingData);
          // Garantir que é um array
          if (!Array.isArray(sessionTranscriptions)) {
            sessionTranscriptions = [];
          }
        } catch (e) {
          console.warn('Erro ao analisar transcrições existentes:', e);
          sessionTranscriptions = [];
        }
      }
      
      // Adicionar nova transcrição
      sessionTranscriptions.push(transcriptionData);
      
      // Salvar de volta no sessionStorage
      sessionStorage.setItem(storageKey, JSON.stringify(sessionTranscriptions));
      console.log('Transcrição salva no sessionStorage para recuperação imediata');
      
      return true;
    } catch (error) {
      console.error('Erro ao salvar transcrição no sessionStorage:', error);
      return false;
    }
  }

  /**
   * Define se análise de emoções está habilitada
   * @param {boolean} enable - Habilitar ou desabilitar análise
   */
  setEmotionAnalysis(enable) {
    this.emotionAnalysisEnabled = !!enable;
    console.log(`Análise de emoções ${this.emotionAnalysisEnabled ? 'habilitada' : 'desabilitada'}`);
    this._dispatchEvent('statusChange', { 
      status: 'config', 
      emotionAnalysis: this.emotionAnalysisEnabled,
      message: `Análise de emoções ${this.emotionAnalysisEnabled ? 'habilitada' : 'desabilitada'}`
    });
  }
}

// Versão estável restaurada
// Exportar como singleton
const whisperTranscriptionService = new WhisperTranscriptionService();
export default whisperTranscriptionService;

/**
 * Gera um ID único para as transcrições
 * @returns {string} ID único
 */
function generateId() {
  return 'tr_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
}