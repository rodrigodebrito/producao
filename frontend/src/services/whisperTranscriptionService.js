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
    
    // Extrair sessionId ao inicializar
    this.sessionId = this.extractSessionId();
    this.speakerRole = this._determineSpeakerRole();
    
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
    
    // NOVO: Informações de controle de sessão e resiliência
    this.sessionStartTime = Date.now();
    this.lastActivityTime = Date.now();
    this.intentionalDisconnect = false;
    this.sessionLogicalId = `${this.sessionId}_${this.sessionStartTime}`;
    this.recoveryAttempted = false;
    this.maxInactivityTime = 30 * 60 * 1000; // 30 minutos
    
    // NOVO: Verificar e limpar transcrições antigas ao inicializar
    this._checkAndCleanStaleData();
    
    // NOVO: Adicionar event listeners para eventos de sessão
    this._setupSessionListeners();
    
    console.log(`WhisperTranscriptionService inicializado - sessionId: ${this.sessionId}, papel: ${this.speakerRole}, logicalId: ${this.sessionLogicalId}`);
  }
  
  /**
   * NOVO: Configura listeners para eventos relacionados à sessão
   * @private
   */
  _setupSessionListeners() {
    // Listener para evento de sessão iniciada
    window.addEventListener('session-started', (event) => {
      console.log('Whisper: Evento session-started detectado, verificando dados');
      
      // Se houver um ID de sessão específico no evento, usá-lo
      if (event.detail && event.detail.sessionId) {
        if (event.detail.sessionId !== this.sessionId) {
          console.log(`Whisper: Atualizando sessionId para ${event.detail.sessionId} via evento`);
          this.updateSessionId(event.detail.sessionId);
        } else {
          // Mesmo sendo o mesmo ID, forçar limpeza pois é uma nova sessão lógica
          console.log('Whisper: Mesmo sessionId mas nova sessão lógica, limpando transcrições');
          this._clearPreviousTranscriptions();
        }
      }
      
      // Atualizar marcadores de tempo da sessão
      this.sessionStartTime = Date.now();
      this.lastActivityTime = Date.now();
      this.sessionLogicalId = `${this.sessionId}_${this.sessionStartTime}`;
      this.recoveryAttempted = false;
      
      console.log(`Whisper: Nova sessão lógica iniciada: ${this.sessionLogicalId}`);
    });
    
    // Listener para evento de página visível/invisível
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('Whisper: Página tornou-se visível, verificando timeout de sessão');
        this._checkSessionValidity();
      }
    });
    
    // Listener para verificar recarregamento de página
    window.addEventListener('beforeunload', () => {
      this.intentionalDisconnect = true;
      sessionStorage.setItem('whisper_intentional_disconnect', 'true');
      sessionStorage.setItem('whisper_last_activity_time', String(this.lastActivityTime));
    });
    
    // Verificar se estamos voltando de um reload de página
    const wasIntentionalDisconnect = sessionStorage.getItem('whisper_intentional_disconnect') === 'true';
    if (wasIntentionalDisconnect) {
      const storedLastActivity = parseInt(sessionStorage.getItem('whisper_last_activity_time') || '0');
      const timeSinceLastActivity = Date.now() - storedLastActivity;
      
      // Se voltou em tempo razoável (menos de 2 minutos), considerar mesma sessão
      if (storedLastActivity > 0 && timeSinceLastActivity < 2 * 60 * 1000) {
        console.log(`Whisper: Retornando à sessão após reload (${timeSinceLastActivity/1000}s), mantendo transcrições`);
      } else {
        // Caso contrário, limpar tudo
        console.log('Whisper: Tempo desde último uso muito longo, limpando dados antigos');
        this._clearAllTranscriptionData();
      }
      
      // Limpar flags
      sessionStorage.removeItem('whisper_intentional_disconnect');
      sessionStorage.removeItem('whisper_last_activity_time');
    }
  }
  
  /**
   * NOVO: Verifica a validade da sessão atual com base no tempo de inatividade
   * @private
   */
  _checkSessionValidity() {
    const now = Date.now();
    const timeSinceLastActivity = now - this.lastActivityTime;
    
    // Se passou muito tempo desde a última atividade, considerar uma nova sessão
    if (timeSinceLastActivity > this.maxInactivityTime) {
      console.log(`Whisper: Inatividade detectada (${Math.round(timeSinceLastActivity/60000)} min). Iniciando nova sessão lógica.`);
      
      // Limpar transcrições antigas
      this._clearPreviousTranscriptions();
      
      // Criar nova ID lógica para sessão
      this.sessionStartTime = now;
      this.lastActivityTime = now;
      this.sessionLogicalId = `${this.sessionId}_${this.sessionStartTime}`;
      
      // Atualizar sessionId se necessário
      const currentSessionId = this.extractSessionId();
      if (currentSessionId !== this.sessionId) {
        this.updateSessionId(currentSessionId);
      }
      
      console.log(`Whisper: Nova sessão lógica criada após inatividade: ${this.sessionLogicalId}`);
    } else {
      console.log(`Whisper: Sessão válida, última atividade há ${Math.round(timeSinceLastActivity/1000)}s`);
      this.lastActivityTime = now;
    }
  }
  
  /**
   * NOVO: Verifica e limpa dados antigos baseado em timestamps
   * @private
   */
  _checkAndCleanStaleData() {
    try {
      const now = Date.now();
      let keysToRemove = [];
      
      // Buscar todas as chaves no localStorage que contêm transcrições
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('whisper_transcript_') || key.startsWith('whisper_transcriptions_'))) {
          try {
            const data = JSON.parse(localStorage.getItem(key));
            
            // Verificar se temos uma array de transcrições com timestamps
            if (Array.isArray(data) && data.length > 0) {
              // Verificar último item
              const lastItem = data[data.length - 1];
              
              if (lastItem && lastItem.timestamp) {
                const timestamp = new Date(lastItem.timestamp).getTime();
                const age = now - timestamp;
                
                // Se tiver mais de 12 horas, remover
                if (age > 12 * 60 * 60 * 1000) {
                  keysToRemove.push(key);
                  console.log(`Whisper: Transcrição antiga detectada em ${key}, idade: ${Math.round(age/3600000)}h`);
                }
              } else if (lastItem && lastItem.clientTimestamp) {
                // Alternativa: usar clientTimestamp
                const age = now - lastItem.clientTimestamp;
                if (age > 12 * 60 * 60 * 1000) {
                  keysToRemove.push(key);
                }
              }
            } else {
              // Para transcrições únicas, verificar se têm mais de 12 horas
              if (data && data.timestamp) {
                const timestamp = new Date(data.timestamp).getTime();
                const age = now - timestamp;
                
                if (age > 12 * 60 * 60 * 1000) {
                  keysToRemove.push(key);
                }
              }
            }
          } catch (e) {
            console.warn(`Whisper: Erro ao verificar dados em ${key}:`, e);
            // Para transcrições com formato inválido, remover
            keysToRemove.push(key);
          }
        }
      }
      
      // Remover chaves antigas
      if (keysToRemove.length > 0) {
        console.log(`Whisper: Removendo ${keysToRemove.length} conjuntos de transcrições antigas`);
        keysToRemove.forEach(key => {
          localStorage.removeItem(key);
          sessionStorage.removeItem(key);
        });
      } else {
        console.log('Whisper: Nenhuma transcrição antiga encontrada');
      }
    } catch (e) {
      console.error('Whisper: Erro ao verificar dados antigos:', e);
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
    
    // Atualizar também o ID lógico
    this.sessionLogicalId = `${this.sessionId}_${this.sessionStartTime}`;
    this.lastActivityTime = Date.now();
    
    // Salvar também no storage para consistência
    try {
      localStorage.setItem('currentSessionId', newSessionId);
      sessionStorage.setItem('currentSessionId', newSessionId); 
    } catch (e) {
      console.warn('Erro ao salvar sessionId no storage:', e);
    }
  }
  
  /**
   * NOVO: Método público para limpar todas as transcrições
   * Pode ser chamado explicitamente pelo código cliente
   */
  clearTranscriptions() {
    console.log('Whisper: Limpeza explícita de transcrições solicitada');
    this._clearPreviousTranscriptions();
    
    // Disparar evento para informar ao sistema que as transcrições foram limpas
    window.dispatchEvent(new CustomEvent('whisper-cleared', {
      detail: { 
        sessionId: this.sessionId,
        timestamp: new Date().toISOString()
      }
    }));
  }
  
  /**
   * NOVO: Limpa absolutamente todos os dados de transcrição do sistema
   * @private
   */
  _clearAllTranscriptionData() {
    console.log('Whisper: Limpando TODOS os dados de transcrição');
    
    try {
      // 1. Limpar o histórico na memória
      this.transcriptionHistory = [];
      
      // 2. Remover todas as entradas de whisper do sessionStorage e localStorage
      this._removeAllWhisperKeysFromStorage(sessionStorage);
      this._removeAllWhisperKeysFromStorage(localStorage);
      
      // 3. Notificar sobre a limpeza via evento
      this._dispatchEvent('allTranscriptionsCleared', {});
      
      // 4. Se tiver AIContext, limpar o transcript
      if (window.__AI_CONTEXT) {
        if (typeof window.__AI_CONTEXT.updateTranscript === 'function') {
          window.__AI_CONTEXT.updateTranscript('');
          console.log('Whisper: Transcript limpo no AIContext');
        }
      }
      
      console.log('Whisper: Limpeza completa de dados concluída');
      return true;
    } catch (e) {
      console.error('Whisper: Erro ao limpar todos os dados:', e);
      return false;
    }
  }
  
  /**
   * NOVO: Remove todas as chaves relacionadas ao Whisper do storage
   * @param {Storage} storage - Objeto de storage (localStorage ou sessionStorage)
   * @private
   */
  _removeAllWhisperKeysFromStorage(storage) {
    try {
      const keysToRemove = [];
      
      // Encontrar todas as chaves relacionadas ao whisper
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && (
          key.startsWith('whisper_') ||
          key.startsWith('transcript_') ||
          key.includes('transcription') ||
          key.includes('_session')
        )) {
          keysToRemove.push(key);
        }
      }
      
      // Remover as chaves encontradas
      keysToRemove.forEach(key => {
        storage.removeItem(key);
        console.log(`Whisper: Removida chave ${key} do storage`);
      });
      
      console.log(`Whisper: Removidas ${keysToRemove.length} chaves do storage`);
    } catch (e) {
      console.warn('Whisper: Erro ao limpar chaves do storage:', e);
    }
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
      console.log('=== INICIANDO NOVA GRAVAÇÃO WAV ===');
      
      // NOVO: Verificar validade da sessão atual antes de iniciar
      this._checkSessionValidity();
      
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
      this.lastActivityTime = Date.now();
      
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
          formData.append('sessionId', this.sessionId);
          formData.append('chunkCounter', String(this.chunkCounter));
          formData.append('clientTimestamp', new Date().toISOString());
          formData.append('format', 'json');
          formData.append('language', 'pt');
          formData.append('speaker', this.speakerRole);
          
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
        sessionId: this.sessionId,
        speaker: this.speakerRole,
        content: transcription.trim(),
        timestamp: new Date().toISOString()
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
}

// Versão estável restaurada
// Exportar como singleton
const whisperTranscriptionService = new WhisperTranscriptionService();
export default whisperTranscriptionService;