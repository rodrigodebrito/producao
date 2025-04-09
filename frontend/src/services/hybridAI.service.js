import aiService from './aiService';
import { initializeTensorFlow } from './tfHelper';
import config from '../environments';

/**
 * Serviço Híbrido de IA para processamento local e remoto
 * 
 * Este serviço implementa uma abordagem híbrida onde algumas análises são
 * realizadas localmente no navegador do usuário e outras no servidor,
 * priorizando privacidade, desempenho e resiliência.
 */
class HybridAIService {
  constructor() {
    // Verificar se estamos no ambiente do navegador
    const isBrowser = typeof window !== 'undefined';
    this.isBrowser = isBrowser;
    
    // Se não estivermos no navegador, retornar sem inicializar
    if (!isBrowser) {
      console.warn('HybridAI: Iniciado fora do navegador, funcionalidade limitada');
      return;
    }
    
    // Inicialização básica dos atributos
    this.isInitialized = false;
    this.isListening = false;
    this.isPaused = false;
    this.isProcessingSpeech = false;
    this.stopRequested = false;
    
    // Configuração de reinício automático
    this.autoRestart = true;
    this.hasRecognitionSupport = false;
    
    // URLs
    this.apiUrl = '';
    
    // Estado de transcrição
    this.transcript = '';
    this.interimTranscript = '';
    this.lastFinalTranscript = '';
    this.sessionId = null;
    this.emotions = {
      joy: 0,
      sadness: 0,
      anger: 0,
      fear: 0,
      surprise: 0,
      disgust: 0,
      neutral: 0
    };
    
    // Configurações de reconhecimento
    this.language = 'pt-BR';
    this.continuousRecognition = true;
    this.interimResults = true;
    this.maxAlternatives = 1;
    
    // Anonimização
    this.useAnonymization = false;
    this.sensitiveWords = [
      'cpf', 'rg', 'identidade', 'cartão', 'senha', 'número', 'endereço',
      'telefone', 'celular', 'conta', 'banco', 'email', 'e-mail'
    ];
    
    // Controle de inatividade - AJUSTADO para maior tolerância
    this.pauseAfterInactivity = true;
    this.inactivityThreshold = 10000; // Aumentado para 10 segundos (era 5000)
    this.inactivityTimer = null;
    this.pausedByInactivity = false;
    this.waitingForSpeech = false;
    
    // Tratamento de erros
    this.errorCount = 0;
    this.maxErrorCount = 10;
    this.lastErrorType = null;
    this.lastErrorTime = null;
    
    // Estatísticas
    this.startTime = null;
    this.totalProcessingTime = 0;
    this.totalCharactersProcessed = 0;
    
    // Inicialização automática
    this.initService();
    
    console.log('HybridAI: Serviço construído');
  }

  async initService() {
    try {
      console.log('HybridAI: Inicializando serviço...');
      
      // Verificar ambiente
      const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1');
      
      // SOLUÇÃO DIRETA: Forçar a URL correta do backend, independentemente de erros
      if (isDevelopment) {
        this.apiUrl = 'http://localhost:3000/api';
      } else {
        // Usar URL do backend em produção (forçada)
        this.apiUrl = 'https://theraconnect-prd.onrender.com/api';
      }
      
      console.log(`HybridAI: API URL forçada para o valor correto: ${this.apiUrl}`);
      
      // Injetar na window para diagnóstico
      if (typeof window !== 'undefined') {
        window.__HYBRID_API = {
          url: this.apiUrl,
          environment: isDevelopment ? 'development' : 'production',
          timestamp: new Date().toISOString()
        };
      }
      
      // Verificar sessionId (extrair da URL se não tiver)
      if (!this.sessionId) {
        this.sessionId = this.extractSessionId();
        console.log(`HybridAI: sessionId extraído: ${this.sessionId}`);
      }
      
      // Carregar emoções
      await this.loadEmotionKeywords();
      
      // Verificar disponibilidade da API Fetch
      if (!fetch) {
        throw new Error('API Fetch não suportada neste navegador');
      }
      
      // Setup do reconhecimento de voz
      this.setupSpeechRecognition();
      
      // Setup de eventos de teclado
      this.handleKeyEvents();
      
      console.log('HybridAI: Serviço inicializado com sucesso!');
      return true;
    } catch (e) {
      console.error('HybridAI: Erro ao inicializar serviço:', e);
      return false;
    }
  }

  // Iniciar gravação
  startRecording() {
    try {
    console.log('HybridAI: Tentando iniciar reconhecimento de voz...');
    
      // Verificar se o reconhecimento já está ativo
    if (this.isRecording) {
        console.log('HybridAI: Reconhecimento já está ativo, nada a fazer');
        return true;
      }
      
      // Verificar suporte
      if (!this.hasRecognitionSupport) {
        console.error('HybridAI: Este navegador não suporta reconhecimento de voz');
        window.dispatchEvent(new CustomEvent('speech-error', {
          detail: { error: 'browser-not-supported' }
        }));
      return false;
    }
    
      // Configurar estado
      this.isRecording = true;
      this.isListening = true; // Garantir que isListening esteja sincronizado
      this.stopRequested = false;
      this.errorCount = 0;
      this.autoRestart = true; // Habilitar reinício automático ao iniciar
      
      // Limpar transcrição intermediária
      this.interimTranscript = '';
      
      // Verificar se o reconhecimento precisa ser reinicializado
      if (!this.recognition) {
        this.setupSpeechRecognition();
      }
      
      // Iniciar o reconhecimento
      console.log('HybridAI: Iniciando reconhecimento de voz...');
      this.recognition.start();
      
      // Emitir evento
      window.dispatchEvent(new CustomEvent('recording-started'));
      
      return true;
    } catch (error) {
      console.error('HybridAI: Erro ao iniciar reconhecimento de voz:', error);
      
      // Limpar estado em caso de erro
      this.isRecording = false;
      this.isListening = false;
      
      // Tentar reinicializar o reconhecimento em caso de erro
      setTimeout(() => {
        this.setupSpeechRecognition();
        this.startRecording();
      }, 1000);
      
      // Emitir evento de erro
      window.dispatchEvent(new CustomEvent('speech-error', {
        detail: { error: 'start-failed' }
      }));
      
      return false;
    }
  }

  /**
   * Configurar o objeto de reconhecimento de voz do navegador
   * @private
   */
  setupSpeechRecognition() {
    try {
      // Verificar disponibilidade da API
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        console.warn('HybridAI: API de reconhecimento de voz não suportada neste navegador');
        this.hasRecognitionSupport = false;
        return false;
      }
      
      console.log('HybridAI: Configurando nova instância de reconhecimento de voz...');
      
      // Inicializar variáveis importantes
      this.lastSpeechTimestamp = Date.now(); // Inicialização da variável
      
      // Criar nova instância
      this.recognition = new SpeechRecognition();
      
      // Configurar parâmetros
      this.recognition.lang = this.language;
      this.recognition.continuous = this.continuousRecognition;
      this.recognition.interimResults = this.interimResults;
      this.recognition.maxAlternatives = this.maxAlternatives;
      
      // AJUSTADO: Reduzir tempo sem voz para reconhecer melhor 
      // falas mais curtas e pausas naturais
      this.recognition.interimResults = true; // Habilitar resultados intermediários
      
      // Aumentar sensibilidade 
      if (this.recognition.audioThreshold !== undefined) {
        this.recognition.audioThreshold = 0.05; // Valor mais baixo = mais sensível
      }
      
      // Eventos
      this.recognition.onstart = () => {
        console.log('HybridAI: Reconhecimento de voz iniciado pelo navegador');
        this.isProcessingSpeech = true;
        this.waitingForSpeech = false;
        this.lastSpeechTimestamp = Date.now();
        
        // Iniciar timer de inatividade se estiver habilitado
        if (this.pauseAfterInactivity) {
          this._startInactivityTimer();
        }
        
        // Disparar evento de início da gravação
        window.dispatchEvent(new CustomEvent('recording-started'));
      };
      
      // Evento para resultados do reconhecimento
      this.recognition.onresult = (event) => {
        try {
          // Atualizar timestamp de última fala
          this.lastSpeechTimestamp = Date.now();
          
          // Processar resultados
          let transcript = '';
          let isFinal = false;
          
          // Verificar se temos resultados
          if (event.results && event.results.length > 0) {
            // Obter o último resultado
            const result = event.results[event.results.length - 1];
            if (result && result.length > 0) {
              transcript = result[0].transcript;
              isFinal = result.isFinal;
            }
          }
          
          if (transcript && transcript.trim().length > 0) {
            // Reiniciar timer de inatividade
            this._resetInactivityTimer();
            
            if (isFinal) {
              console.log('HybridAI: Texto final reconhecido:', transcript);
              this._handleFinalSpeechResult(transcript);
            } else {
              // Resultados intermediários não precisam de log para não sobrecarregar o console
              this._handleInterimSpeechResult(transcript);
            }
            
            // Reiniciar o timer de inatividade após um resultado
            this._resetInactivityTimer();
          }
        } catch (e) {
          console.error('HybridAI: Erro ao processar resultado do reconhecimento:', e);
        }
      };
      
      this.hasRecognitionSupport = true;
      return true;
    } catch (e) {
      console.error('HybridAI: Erro ao configurar reconhecimento de voz:', e);
      this.hasRecognitionSupport = false;
      return false;
    }
  }

  // Método centralizado para lidar com erros de reconhecimento
  handleRecognitionError(event) {
    // Incrementar contador de erros
    this.errorCount++;
    
    // Verificar se atingiu o limite de erros
    const maxErrorsReached = this.errorCount >= this.maxErrorCount;
    
    // Disparar evento de erro para interface
        window.dispatchEvent(new CustomEvent('speech-error', {
      detail: { 
        error: event.error || 'unknown',
        count: this.errorCount,
        maxReached: maxErrorsReached
      }
    }));
    
    // Tratamento específico por tipo de erro
    switch (event.error) {
      case 'not-allowed':
        // Erro de permissão - parar completamente
      this.isRecording = false;
        this.recognitionActive = false;
        this.showSpeechStatus('error', 'Permissão de microfone negada');
        window.dispatchEvent(new CustomEvent('recording-stopped'));
        break;
        
      case 'aborted':
        // Erro de aborto - pode ser normal durante reinicializações
        // Ignorar com limite de contagem
        if (maxErrorsReached) {
          this.isRecording = false;
          this.recognitionActive = false;
          this.showSpeechStatus('error', 'Muitas interrupções');
          window.dispatchEvent(new CustomEvent('recording-stopped'));
        }
        break;
        
      case 'network':
        // Erro de rede - tentar novamente após uma pausa maior
        this.isRecording = false;
        this.recognitionActive = false;
        this.showSpeechStatus('error', 'Erro de rede');
      window.dispatchEvent(new CustomEvent('recording-stopped'));
        break;
        
      default:
        // Para outros erros, verificar o contador
        if (maxErrorsReached) {
      this.isRecording = false;
          this.recognitionActive = false;
          this.showSpeechStatus('error', 'Muitos erros');
          window.dispatchEvent(new CustomEvent('recording-stopped'));
        }
        break;
    }
  }
  
  // Método para mostrar status da transcrição na interface
  showSpeechStatus(status, message = '') {
    try {
      // Criar ou atualizar elemento de status
      let statusElement = document.getElementById('speech-status-indicator');
      
      if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.id = 'speech-status-indicator';
        statusElement.style.position = 'fixed';
        statusElement.style.bottom = '20px';
        statusElement.style.right = '20px';
        statusElement.style.padding = '8px 12px';
        statusElement.style.borderRadius = '20px';
        statusElement.style.fontSize = '12px';
        statusElement.style.fontFamily = 'sans-serif';
        statusElement.style.zIndex = '9999';
        statusElement.style.transition = 'all 0.3s ease';
        document.body.appendChild(statusElement);
      }
      
      // Atualizar estilo e conteúdo com base no status
      switch (status) {
        case 'active':
          statusElement.style.backgroundColor = 'rgba(46, 204, 113, 0.8)';
          statusElement.style.color = 'white';
          statusElement.textContent = '🎙️ Transcrição ativa';
          break;
          
        case 'inactive':
          statusElement.style.backgroundColor = 'rgba(52, 73, 94, 0.8)';
          statusElement.style.color = 'white';
          statusElement.textContent = '🎙️ Transcrição pausada';
          
          // Auto remover após alguns segundos
          setTimeout(() => {
            if (statusElement.parentNode) {
              statusElement.style.opacity = '0';
              setTimeout(() => {
                if (statusElement.parentNode) {
                  statusElement.parentNode.removeChild(statusElement);
                }
              }, 500);
            }
          }, 3000);
          break;
          
        case 'error':
          statusElement.style.backgroundColor = 'rgba(231, 76, 60, 0.8)';
          statusElement.style.color = 'white';
          statusElement.textContent = `⚠️ ${message || 'Erro na transcrição'}`;
          break;
          
        default:
          statusElement.style.display = 'none';
      }
    } catch (e) {
      console.warn('HybridAI: Erro ao mostrar status:', e);
    }
  }
  
  // Mostrar interface de fallback para navegadores não suportados
  showFallbackInterface() {
    try {
      let fallbackElement = document.getElementById('speech-fallback');
      
      if (!fallbackElement) {
        fallbackElement = document.createElement('div');
        fallbackElement.id = 'speech-fallback';
        fallbackElement.style.position = 'fixed';
        fallbackElement.style.top = '50%';
        fallbackElement.style.left = '50%';
        fallbackElement.style.transform = 'translate(-50%, -50%)';
        fallbackElement.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        fallbackElement.style.color = 'white';
        fallbackElement.style.padding = '20px';
        fallbackElement.style.borderRadius = '10px';
        fallbackElement.style.maxWidth = '400px';
        fallbackElement.style.textAlign = 'center';
        fallbackElement.style.zIndex = '10000';
        
        fallbackElement.innerHTML = `
          <h3 style="margin-top: 0">Reconhecimento de voz não suportado</h3>
          <p>Seu navegador não suporta a API de reconhecimento de voz.</p>
          <p>Tente usar Chrome, Edge ou Safari.</p>
          <button id="speech-fallback-close" style="
            padding: 8px 16px;
            background-color: #3498db;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 10px;
          ">Fechar</button>
        `;
        
        document.body.appendChild(fallbackElement);
        
        // Adicionar handler para fechar
        document.getElementById('speech-fallback-close').addEventListener('click', () => {
          if (fallbackElement.parentNode) {
            fallbackElement.parentNode.removeChild(fallbackElement);
          }
        });
      }
    } catch (e) {
      console.warn('HybridAI: Erro ao mostrar interface de fallback:', e);
    }
  }

  // Parar gravação
  stopRecording() {
    try {
      console.log('HybridAI: Tentando parar reconhecimento de voz...');
      
      // Marcar que a parada foi solicitada para evitar reinício automático
      this.stopRequested = true;
      this.autoRestart = false;
      
      // Limpar qualquer timeout pendente
      if (this.restartTimeout) {
        clearTimeout(this.restartTimeout);
        this.restartTimeout = null;
      }
      
      // Verificar se está realmente em execução
      if (this.recognition && this.isProcessingSpeech) {
        this.recognition.stop();
        this.isListening = false;
      } else {
        console.log('HybridAI: Reconhecimento já está parado');
        this.isListening = false;
        // Disparar evento de parada para garantir sincronização com a UI
        window.dispatchEvent(new CustomEvent('recording-stopped'));
      }
    } catch (e) {
      console.error('HybridAI: Erro ao parar reconhecimento de voz:', e);
      // Forçar estado para parado
      this.isListening = false;
      this.isProcessingSpeech = false;
      window.dispatchEvent(new CustomEvent('recording-stopped'));
    }
  }

  // Processar resultados de fala
  handleSpeechResult(event) {
    try {
      if (!event || !event.results) {
        return;
      }
      
      // Extrair os resultados mais recentes
      const results = event.results;
      const current = results[results.length - 1];
      
      if (!current || !current[0]) {
        return;
      }
      
      // Extrair o texto reconhecido e a confiança
      const transcript = current[0].transcript.trim();
      const confidence = current[0].confidence;
      
      // Verificar se o texto está vazio ou é muito curto (filtro de ruído)
      if (!transcript || transcript.length < 1) {
        return;
      }
      
      console.log(`HybridAI: Texto reconhecido: "${transcript}" (confiança: ${confidence.toFixed(2)})`);
      
      // Determinar se é resultado final ou intermediário
      const isFinal = current.isFinal;
      
      if (isFinal) {
        // Processar resultado final
        this._handleFinalSpeechResult(transcript);
      } else {
        // Processar resultado intermediário
        this._handleInterimSpeechResult(transcript);
      }
      
      // Disparar evento global para debug
      window.dispatchEvent(new CustomEvent('speech-processed', {
        detail: { 
          text: transcript, 
          isFinal: isFinal, 
          confidence: confidence
        }
      }));
    } catch (error) {
      console.error('HybridAI: Erro ao processar resultado do reconhecimento de voz:', error);
    }
  }

  // Método para extrair o sessionId da URL
  extractSessionId() {
    try {
      // Tentar extrair da URL
      const url = window.location.href;
      
      console.log('HybridAI: Extraindo sessionId de URL:', url);
      
      // Primeiro tentar obter do localStorage (prioridade)
      const savedSessionId = localStorage.getItem('currentSessionId');
      if (savedSessionId) {
        console.log('HybridAI: SessionId encontrado no localStorage:', savedSessionId);
        return savedSessionId;
      }
      
      // Tentar padrão /session/{id}
      const sessionMatch = url.match(/\/session\/([a-zA-Z0-9_-]+)/);
      if (sessionMatch && sessionMatch[1]) {
        console.log('HybridAI: SessionId extraído da URL (padrão /session/):', sessionMatch[1]);
        // Salvar no localStorage para usos futuros
        try {
          localStorage.setItem('currentSessionId', sessionMatch[1]);
        } catch (e) {
          console.warn('HybridAI: Não foi possível salvar sessionId no localStorage:', e);
        }
        return sessionMatch[1];
      }
      
      // Tentar padrão /meet/{id}
      const meetMatch = url.match(/\/meet\/([a-zA-Z0-9_-]+)/);
      if (meetMatch && meetMatch[1]) {
        console.log('HybridAI: SessionId extraído da URL (padrão /meet/):', meetMatch[1]);
        return meetMatch[1];
      }
      
      // Tentar padrão /room/{id}
      const roomMatch = url.match(/\/room\/([a-zA-Z0-9_-]+)/);
      if (roomMatch && roomMatch[1]) {
        console.log('HybridAI: SessionId extraído da URL (padrão /room/):', roomMatch[1]);
        return roomMatch[1];
      }
      
      // Tentar padrão /call/{id}
      const callMatch = url.match(/\/call\/([a-zA-Z0-9_-]+)/);
      if (callMatch && callMatch[1]) {
        console.log('HybridAI: SessionId extraído da URL (padrão /call/):', callMatch[1]);
        return callMatch[1];
      }
      
      // Tentar extrair UUID/GUID da URL (usado em muitos sistemas)
      const uuidMatch = url.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
      if (uuidMatch && uuidMatch[0]) {
        console.log('HybridAI: SessionId extraído da URL (formato UUID):', uuidMatch[0]);
        return uuidMatch[0];
      }
      
      // Tentar extrair de params (ex: ?sessionId=123)
      const urlParams = new URLSearchParams(window.location.search);
      const paramOptions = ['sessionId', 'session', 'meetingId', 'meeting', 'roomId', 'room', 'id', 'callId'];
      
      for (const param of paramOptions) {
        const value = urlParams.get(param);
        if (value) {
          console.log(`HybridAI: SessionId extraído dos parâmetros da URL (${param}):`, value);
          return value;
        }
      }
      
      // Verificar localStorage/sessionStorage para um sessionId salvo (opções adicionais)
      const alternativeSavedId = localStorage.getItem('sessionId') || 
                          sessionStorage.getItem('sessionId') ||
                          localStorage.getItem('meetingId') || 
                          sessionStorage.getItem('meetingId');
      
      if (alternativeSavedId) {
        console.log('HybridAI: SessionId recuperado do armazenamento alternativo:', alternativeSavedId);
        return alternativeSavedId;
      }
      
      // Verificar data attributes em elementos relevantes
      const sessionElements = document.querySelectorAll('[data-session-id], [data-meeting-id], [data-room-id]');
      if (sessionElements.length > 0) {
        const elementId = sessionElements[0].getAttribute('data-session-id') || 
                         sessionElements[0].getAttribute('data-meeting-id') || 
                         sessionElements[0].getAttribute('data-room-id');
        
        if (elementId) {
          console.log('HybridAI: SessionId extraído de atributo data:', elementId);
          return elementId;
        }
      }
      
      // Se não encontrou por nenhum método, alertar e retornar um ID temporário
      console.warn('HybridAI: Não foi possível encontrar um sessionId válido em nenhum local');
      
      // Disparar evento para notificar a interface
      window.dispatchEvent(new CustomEvent('hybridai-error', {
        detail: { 
          message: 'Não foi possível identificar a sessão atual',
          type: 'session'
        }
      }));
      
      // Retornar valor temporário mas marcado para identificar facilmente
      return `temp_${new Date().getTime()}`;
    } catch (e) {
      console.error('HybridAI: Erro ao extrair sessionId:', e);
      return `error_${new Date().getTime()}`;
    }
  }

  // Processar emoções no texto
  processEmotions(text) {
    if (!text) return;
    
    try {
      // Converter para minúsculas e remover pontuações
      const cleanText = text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
      const words = cleanText.split(' ');
      
      // Contar palavras-chave de emoções
      for (const word of words) {
        if (word && this.emotionKeywords && this.emotionKeywords[word]) {
          const emotion = this.emotionKeywords[word];
          this.emotions[emotion]++;
          
          console.log(`HybridAI: Emoção detectada: "${word}" -> ${emotion} (${this.emotions[emotion]})`);
          
          // Disparar evento de emoção detectada
          window.dispatchEvent(new CustomEvent('emotion-detected', {
            detail: {
              emotion,
              word,
              accumulated: { ...this.emotions }
            }
          }));
        }
      }
    } catch (error) {
      console.error('HybridAI: Erro ao processar emoções:', error);
    }
  }

  // Anonimizar texto para evitar enviar dados sensíveis
  anonymizeText(text) {
    if (!text || !this.useAnonymization) return text;
    
    let anonymized = text;
    
    // Substituir palavras sensíveis
    for (const word of this.sensitiveWords) {
      const regex = new RegExp(`\\b${word}\\b[^\\s]*`, 'gi');
      anonymized = anonymized.replace(regex, `[${word.toUpperCase()} REMOVIDO]`);
    }
    
    // Remover números de telefone
    anonymized = anonymized.replace(/\b(\d{2}[\s.-]?)?\d{4,5}[\s.-]?\d{4}\b/g, '[TELEFONE REMOVIDO]');
    
    // Remover CPF
    anonymized = anonymized.replace(/\b\d{3}[\s.-]?\d{3}[\s.-]?\d{3}[\s.-]?\d{2}\b/g, '[CPF REMOVIDO]');
    
    return anonymized;
  }

  // Obter token de autenticação
  getAuthToken() {
    try {
      // Tentar obter de localStorage ou sessionStorage
      const token = localStorage.getItem('authToken') || 
             sessionStorage.getItem('authToken') || 
             localStorage.getItem('token') || 
             sessionStorage.getItem('token');
      
      if (!token) {
        console.warn('HybridAI: Token de autenticação não encontrado');
        return null;
      }
      
      return token;
    } catch (e) {
      console.error('HybridAI: Erro ao obter token de autenticação:', e);
      return null;
    }
  }
  
  // Disparar erro de autenticação
  dispatchAuthError() {
    console.warn('HybridAI: Erro de autenticação - token não encontrado ou inválido');
    
    // Disparar evento para informar sobre erro de autenticação
    window.dispatchEvent(new CustomEvent('hybridai-error', {
      detail: {
        message: 'Sessão expirada. Por favor, faça login novamente.',
        type: 'auth'
      }
    }));
  }

  // Método para enviar transcrição ao servidor
  async sendTranscriptionToServer(transcript, emotions = null) {
    try {
      console.log('HybridAI: Preparando para enviar transcrição ao servidor');
      
      // SOLUÇÃO DIRETA: Forçar o uso da URL do backend correta, ignorando this.apiUrl
      // Isso resolve o problema onde a configuração incorreta persiste após a inicialização
      const endpoint = 'https://theraconnect-prd.onrender.com/api/ai/transcript';
      
      console.log(`HybridAI: Usando endpoint fixo para transcrição: ${endpoint}`);
      
      // Obter token de autenticação
      const authToken = this.getAuthToken();
      if (!authToken) {
        console.error('HybridAI: Token de autenticação não encontrado');
        this.dispatchAuthError();
        throw new Error('Token de autenticação não encontrado ou inválido');
      }
      
      // CORREÇÃO CRÍTICA: O backend espera um campo "transcript" em vez de "content"
      // Formatar os dados no formato esperado pelo backend
      const data = {
        sessionId: this.sessionId,
        speaker: this.userRole || 'paciente', // Default para paciente se não especificado
        transcript: transcript, // ALTERADO: usar "transcript" como o backend espera
        timestamp: new Date().toISOString(),
      };
      
      // Adicionar emoções se disponíveis
      if (emotions) {
        data.emotions = emotions;
      }
      
      console.log(`HybridAI: Enviando transcrição para o servidor (${transcript.length} caracteres)`);
      console.log('HybridAI: Payload de dados:', data);
      
      // Enviar os dados via POST
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(data)
      });
      
      // Verificar o status e tratar resposta adequadamente para evitar leitura dupla
      if (!response.ok) {
        let errorMessage;
        try {
          // Ler resposta apenas uma vez e guardar o resultado
          const errorResponse = await response.json();
          errorMessage = errorResponse.message || errorResponse.error || `Erro ${response.status}: ${response.statusText}`;
        } catch (parseError) {
          // Se não conseguir ler como JSON, usar texto de status
          errorMessage = `Erro ${response.status}: ${response.statusText}`;
        }
        
        console.error('HybridAI: Erro na resposta do servidor:', errorMessage);
        
        if (response.status === 401 || response.status === 403) {
          // Problema de autenticação
          this.dispatchAuthError();
          throw new Error('Sessão expirada ou inválida. Faça login novamente.');
        }
        
        throw new Error(errorMessage);
      }
      
      try {
        // Ler a resposta apenas uma vez
        const result = await response.json();
        console.log('HybridAI: Transcrição salva com sucesso:', result);
        return result;
      } catch (parseError) {
        console.warn('HybridAI: Erro ao processar resposta JSON, mas requisição bem-sucedida');
        return { success: true };
      }
    } catch (error) {
      console.error('HybridAI: Erro ao enviar transcrição para o servidor:', error);
      
      // Disparar evento de erro para interface
      window.dispatchEvent(new CustomEvent('hybridai-error', {
        detail: { 
          message: `Erro ao salvar transcrição: ${error.message}`,
          type: 'api'
        }
      }));
      
      throw error;
    }
  }

  // Analisar texto com IA
  async analyzeText(text) {
    try {
      if (!text || text.trim().length < 10) {
        console.warn('HybridAI: Texto insuficiente para análise');
        return { 
          type: 'analysis',
          error: 'Texto insuficiente para análise',
          analysis: 'É necessário mais conteúdo na sessão para realizar uma análise útil.',
          content: 'Continue a conversa para obter insights baseados na interação.'
        };
      }
      
      // Obter ID da sessão da URL
      const sessionId = this.extractSessionId();
      
      // Verificar se temos um ID válido
      if (!sessionId || sessionId.length > 50) {
        console.error('HybridAI: ID de sessão inválido para análise:', sessionId);
        return { 
          type: 'analysis',
          error: 'ID de sessão inválido',
          analysis: 'Não foi possível identificar corretamente a sessão atual.',
          content: 'Recarregue a página ou verifique a URL da sessão.'
        };
      }
      
      console.log(`HybridAI: Analisando texto para sessão ${sessionId}`);
      
      // Enviar para o servidor para análise
      let result;
      try {
        result = await aiService.analyzeSession(sessionId, text);
        console.log('HybridAI: Resultado da análise recebido:', result);
      } catch (apiError) {
        console.error('HybridAI: Erro na chamada da API:', apiError);
        // Criar resposta de fallback
        result = {
          type: 'analysis',
          error: 'Falha na comunicação com o servidor',
          message: apiError.message,
          analysis: 'Não foi possível analisar a sessão atual devido a um problema técnico.',
          content: 'O servidor está temporariamente indisponível.'
        };
      }
      
      // Verificar se o resultado contém dados
      if (!result || (Object.keys(result).length === 0)) {
        console.warn('HybridAI: Resultado vazio ou inválido recebido');
        result = {
          type: 'analysis',
          analysis: 'Não foi possível identificar padrões específicos neste momento.',
          content: 'Continue a sessão para permitir uma análise mais profunda.'
        };
      }
      
      // Garantir que o tipo está definido
      if (!result.type) {
        result.type = 'analysis';
      }
      
      // Garantir que há conteúdo de análise
      if (!result.analysis && !result.content && !result.error) {
        // Se temos alguma resposta do servidor, mas sem análise específica
        if (result.data && result.data.analysis) {
          result.analysis = result.data.analysis;
        } else {
          result.analysis = 'Baseado na conversa atual, não foram identificados padrões específicos que necessitem de atenção.';
          result.content = 'A sessão está progredindo sem aspectos que exijam intervenção imediata.';
        }
      }
      
      return result;
    } catch (error) {
      console.error('HybridAI: Erro ao analisar texto:', error);
      return { 
        type: 'analysis', 
        error: 'Erro ao analisar texto', 
        message: error.message,
        analysis: 'Ocorreu um erro ao processar a análise da sessão.',
        content: 'Tente novamente em alguns instantes.'
      };
    }
  }
  
  // Gerar sugestões
  async generateSuggestions(text) {
    try {
      if (!text || text.trim().length < 10) {
        console.warn('HybridAI: Texto insuficiente para sugestões');
        return { 
          type: 'suggestions',
          error: 'Texto insuficiente para sugestões',
          suggestions: ['Aguarde até que haja mais conteúdo na sessão.'],
          content: 'É necessário mais conteúdo na sessão para gerar sugestões úteis.'
        };
      }
      
      // Obter ID da sessão da URL
      const sessionId = this.extractSessionId();
      
      // Verificar se temos um ID válido
      if (!sessionId || sessionId.length > 50) {
        console.error('HybridAI: ID de sessão inválido para sugestões:', sessionId);
        return { 
          type: 'suggestions',
          error: 'ID de sessão inválido',
          suggestions: ['Não foi possível identificar corretamente a sessão atual.'],
          content: 'Recarregue a página ou verifique a URL da sessão.'
        };
      }
      
      console.log(`HybridAI: Gerando sugestões para sessão ${sessionId}`);
      
      // Enviar para o servidor para sugestões
      let result;
      try {
        result = await aiService.generateSuggestions(sessionId, text);
        console.log('HybridAI: Resultado das sugestões recebido:', result);
      } catch (apiError) {
        console.error('HybridAI: Erro na chamada da API:', apiError);
        // Criar resposta de fallback
        result = {
          type: 'suggestions',
          error: 'Falha na comunicação com o servidor',
          message: apiError.message,
          suggestions: ['Tente novamente em alguns instantes.'],
          content: 'O servidor está temporariamente indisponível.'
        };
      }
      
      // Verificar se o resultado contém dados
      if (!result || (Object.keys(result).length === 0)) {
        console.warn('HybridAI: Resultado vazio ou inválido recebido');
        result = {
          type: 'suggestions',
          suggestions: ['Não foi possível gerar sugestões específicas neste momento.'],
          content: 'Continue a sessão para obter resultados mais específicos.'
        };
      }
      
      // Garantir que o tipo está definido
      if (!result.type) {
        result.type = 'suggestions';
      }
      
      // Garantir que há sugestões
      if (!result.suggestions && !result.error) {
        result.suggestions = ['Baseado na conversa atual, continue o diálogo normalmente.'];
        result.content = 'Não foram identificados aspectos que necessitem de sugestões específicas.';
      }
      
      return result;
    } catch (error) {
      console.error('HybridAI: Erro ao gerar sugestões:', error);
      return { 
        type: 'suggestions', 
        error: 'Erro ao gerar sugestões', 
        message: error.message,
        suggestions: ['Ocorreu um erro técnico. Tente novamente.'],
        content: 'Houve um problema ao processar as sugestões.'
      };
    }
  }
  
  // Gerar relatório
  async generateReport(text) {
    try {
      if (!text || text.trim().length < 10) {
        console.warn('HybridAI: Texto insuficiente para relatório');
        return { 
          type: 'report',
          error: 'Texto insuficiente para relatório',
          report: `**Texto insuficiente para gerar um relatório completo**

Para gerar um relatório detalhado, é necessário mais conteúdo da sessão.
Continue a sessão e tente novamente quando houver mais diálogo entre terapeuta e cliente.

*Recomendações:*
- Certifique-se de que o microfone está ativo durante a sessão
- Verifique se a transcrição está funcionando corretamente
- Sessões com pelo menos 15-20 minutos de diálogo geralmente produzem melhores relatórios`,
          content: 'Continue a sessão para capturar mais dados para o relatório.'
        };
      }
      
      // Obter ID da sessão da URL
      const sessionId = this.extractSessionId();
      
      // Verificar se temos um ID válido
      if (!sessionId || sessionId.length > 50) {
        console.error('HybridAI: ID de sessão inválido para relatório:', sessionId);
        return { 
          type: 'report',
          error: 'ID de sessão inválido',
          report: `**Não foi possível gerar o relatório**

O sistema não conseguiu identificar corretamente a sessão atual.

*Possíveis razões:*
- URL da sessão incorreta ou malformada
- Problema na identificação da sessão no sistema
- Erro temporário no serviço

*Recomendações:*
- Recarregue a página
- Verifique se você está na URL correta da sessão
- Se o problema persistir, tente criar uma nova sessão`,
          content: 'Não foi possível identificar corretamente a sessão atual.'
        };
      }
      
      console.log(`HybridAI: Gerando relatório para sessão ${sessionId}`);
      
      // Enviar para o servidor para relatório
      let result;
      try {
        result = await aiService.generateReport(sessionId, text);
        console.log('HybridAI: Resultado do relatório recebido:', result);
      } catch (apiError) {
        console.error('HybridAI: Erro na chamada da API:', apiError);
        // Criar resposta de fallback mais útil
        return {
          type: 'report',
          error: 'Falha na comunicação com o servidor',
          message: apiError.message,
          report: `**Não foi possível conectar ao serviço de relatórios**

O sistema encontrou um problema ao tentar gerar o relatório desta sessão.

*Possíveis causas:*
- Problemas de conectividade com o servidor
- Sobrecarga temporária do sistema
- Limitações da API do serviço de IA

*Recomendações:*
- Verifique sua conexão com a internet
- Aguarde alguns minutos e tente novamente
- Se o problema persistir, entre em contato com o suporte técnico

Detalhes técnicos: ${apiError.message || 'Erro de comunicação com o servidor'}`,
          content: 'O servidor está temporariamente indisponível.'
        };
      }
      
      // Verificar se o resultado contém dados
      if (!result || (Object.keys(result).length === 0)) {
        console.warn('HybridAI: Resultado vazio ou inválido recebido');
        return {
          type: 'report',
          report: `**Relatório não disponível**

Não foi possível gerar um relatório específico para esta sessão no momento.

*Possíveis causas:*
- A sessão pode ser muito curta
- A qualidade do áudio pode estar comprometida
- Pode haver poucos elementos terapêuticos para análise

*Recomendações:*
- Continue a sessão por mais tempo
- Verifique se o microfone está funcionando corretamente
- Tente novamente após mais interações terapeuta-cliente`,
          content: 'Continue a sessão para obter resultados mais completos.'
        };
      }
      
      // Verificar se há um relatório válido no resultado
      if (result.report && typeof result.report === 'string') {
        // Verificar se o conteúdo é genérico demais
        if (result.report.includes('Não foi possível gerar conteúdo específico') || 
            result.report.trim().length < 100) {
          
          console.warn('HybridAI: Conteúdo do relatório parece genérico ou muito curto');
          return {
            type: 'report',
            report: `**Relatório parcial da sessão**

O sistema não conseguiu gerar um relatório detalhado para esta sessão específica.

*Possíveis razões:*
- Poucos dados de transcrição disponíveis
- Limitações temporárias do modelo de IA
- Problemas no processamento do contexto da sessão

*Sugestões para o terapeuta:*
1. Verifique a qualidade da transcrição da sessão
2. Tente solicitar o relatório novamente após mais diálogo
3. Considere fazer anotações manuais complementares

*Observações gerais para sessões terapêuticas:*
- Mantenha uma comunicação clara e empática
- Observe as reações e sinais não-verbais do paciente
- Faça perguntas abertas para explorar sentimentos e pensamentos
- Valide as experiências e emoções do paciente
- Estabeleça metas claras para o tratamento`,
            content: 'Relatório parcial com recomendações gerais para o terapeuta.'
          };
        }
      }
      
      // Garantir que o tipo está definido
      if (!result.type) {
        result.type = 'report';
      }
      
      // Verificar se há conteúdo significativo
      if (result.report && result.report.length < 200) {
        console.warn('HybridAI: Relatório parece muito curto:', result.report);
      }
      
      return result;
    } catch (error) {
      console.error('HybridAI: Erro ao gerar relatório:', error);
      return {
        type: 'report',
        error: 'Erro durante processamento do relatório',
        report: `**Erro ao gerar relatório**

Ocorreu um erro inesperado durante a geração do relatório.

*Detalhes técnicos:* ${error.message || 'Erro desconhecido'}

*Recomendações:*
- Recarregue a página e tente novamente
- Verifique se a sessão está ativa
- Se o problema persistir, entre em contato com o suporte`,
        content: 'Ocorreu um erro inesperado. Por favor, tente novamente.'
      };
    }
  }

  // Configurações
  setLocalProcessing(enabled) {
    this.useLocalProcessing = enabled;
  }

  setAnonymization(enabled) {
    this.useAnonymization = enabled;
  }

  // Verificar suporte
  isSpeechRecognitionSupported() {
    return !!this.recognition;
  }
  
  // Reiniciar o reconhecimento de voz
  restartRecognition() {
    try {
      if (this.isListening && !this.stopRequested) {
        // Limpar o timeout para evitar múltiplos reinícios
        if (this.restartTimeout) {
          clearTimeout(this.restartTimeout);
          this.restartTimeout = null;
        }
        
        // Verificar se outro reconhecimento já está em andamento
        if (this.isProcessingSpeech) {
          console.log('HybridAI: Já existe um reconhecimento em andamento');
          return;
        }
          
          // Iniciar reconhecimento
        console.log('HybridAI: Reiniciando reconhecimento');
        this.recognition.start();
      } else {
        console.log('HybridAI: Reconhecimento não reiniciado, pois não está mais em modo de escuta');
      }
    } catch (e) {
      console.error('HybridAI: Erro ao reiniciar reconhecimento:', e);
    }
  }

  // Carregar dicionário de emoções
  async loadEmotionKeywords() {
    try {
      // Palavras-chave para detecção de emoções
      this.emotionKeywords = {
        // Palavras em português que indicam emoções
        'feliz': 'happiness',
        'felicidade': 'happiness',
        'alegre': 'happiness',
        'alegria': 'happiness',
        'contente': 'happiness',
        'satisfeito': 'happiness',
        
        'triste': 'sadness',
        'tristeza': 'sadness',
        'deprimido': 'sadness',
        'depressão': 'sadness',
        'melancólico': 'sadness',
        'infeliz': 'sadness',
        
        'raiva': 'anger',
        'irritado': 'anger',
        'bravo': 'anger',
        'furioso': 'anger',
        'revoltado': 'anger',
        'nervoso': 'anger',
        
        'medo': 'fear',
        'assustado': 'fear',
        'tenso': 'fear',
        'ansioso': 'fear',
        'preocupado': 'fear',
        'apreensivo': 'fear',
        
        'surpresa': 'surprise',
        'surpreso': 'surprise',
        'chocado': 'surprise',
        'espantado': 'surprise',
        'impressionado': 'surprise',
        
        'nojo': 'disgust',
        'repulsa': 'disgust',
        'repugnante': 'disgust',
        'aversão': 'disgust',
        
        'calmo': 'neutral',
        'tranquilo': 'neutral',
        'neutro': 'neutral',
        'normal': 'neutral'
      };
      
      console.log('HybridAI: Dicionário de emoções carregado com sucesso');
      return true;
    } catch (error) {
      console.error('HybridAI: Erro ao carregar dicionário de emoções:', error);
      return false;
    }
  }

  // Alternar estado de reinício automático
  toggleAutoRestart(enable) {
    this.autoRestart = enable === undefined ? !this.autoRestart : enable;
    console.log(`HybridAI: Reinício automático ${this.autoRestart ? 'ativado' : 'desativado'}`);
    return this.autoRestart;
  }
  
  /**
   * Processa o resultado final do reconhecimento de voz
   * @param {string} transcript - Texto transcrito final
   * @param {boolean} isExternalTranscription - Se a transcrição vem de uma fonte externa como Whisper
   * @private
   */
  async _handleFinalSpeechResult(transcript, isExternalTranscription = false) {
    try {
      // Verificar duplicação apenas em transcrições internas (não externas)
      if (!isExternalTranscription && this._checkForDuplication(transcript)) {
        console.warn('HybridAI: Duplicação detectada, ignorando:', transcript.substring(0, 20) + '...');
        return;
      }
      
      // Validar o texto recebido
      if (!transcript || transcript.trim().length === 0) {
        console.warn('HybridAI: Texto final vazio, ignorando');
        return;
      }
      
      // DESTACAR TRANSCRIÇÃO NO CONSOLE PARA MELHOR VISUALIZAÇÃO
      console.log('\n%c TRANSCRIÇÃO CAPTURADA: %c' + transcript + '\n', 
        'background: #4CAF50; color: white; font-weight: bold; padding: 5px;', 
        'background: #f1f1f1; color: #333; padding: 5px; font-weight: normal; border-left: 4px solid #4CAF50');
      
      // Mostrar no elemento visual temporário na tela
      this._showTranscriptionOnScreen(transcript, isExternalTranscription);
      
      // Processar e anonimizar se necessário
      let processedText = transcript;
      if (this.useAnonymization) {
        processedText = this.anonymizeText(processedText);
      }
      
      // Extrair emoções do texto (se estiver usando ML local)
      const emotions = await this.processEmotions(processedText);
      
      // Atualizar o texto completo da sessão
      this._saveTranscription(processedText);
      
      // Disparar evento para a interface
      window.dispatchEvent(new CustomEvent('transcription-final', {
        detail: { 
          text: processedText,
          emotions,
          timestamp: new Date().toISOString(),
          isInterim: false,
          sessionId: this.sessionId,
          isExternal: isExternalTranscription,
          source: isExternalTranscription ? 'whisper' : 'webspeech'
        }
      }));
      
      if (!isExternalTranscription) {
        // Despachar texto para TTS (se habilitado)
        window.dispatchEvent(new CustomEvent('tts-text', {
          detail: { text: processedText }
        }));
      }
      
      // Realizar tarefas de IA em segundo plano baseadas na transcrição
      this._processBackgroundTasks(processedText);
      
      // Enviar para o servidor (evitar duplicação para whisper)
      if (!isExternalTranscription) {
        await this.sendTranscriptionToServer(processedText, emotions);
      }
      
      // Resetar o texto interino
      this.interimTranscript = '';
    } catch (error) {
      console.error('HybridAI: Erro ao processar texto final:', error);
    }
  }

  /**
   * Manipula resultados intermediários/parciais de reconhecimento
   * @param {string} transcript - Texto parcial
   * @private 
   */
  _handleInterimSpeechResult(transcript) {
    // Validar transcricão
    if (!transcript || transcript.trim().length === 0) return;
    
    // Atualizar texto intermediário
    this.interimTranscript = transcript;
    
    // Mostrar no console com formatação diferente (cinza para intermediário)
    console.log('%c TRANSCRIÇÃO (parcial): %c' + transcript, 
      'background: #9E9E9E; color: white; font-weight: bold; padding: 3px;', 
      'color: #666; font-style: italic;');
    
    // Mostrar na tela
    this._showTranscriptionOnScreen(transcript, false, true);
    
    // Disparar evento para a interface
    window.dispatchEvent(new CustomEvent('transcription-interim', {
      detail: { 
        text: transcript,
        timestamp: new Date().toISOString(),
        isInterim: true,
        sessionId: this.sessionId
      }
    }));
  }
  
  /**
   * Exibe a transcrição na tela de forma temporária (para debug)
   * @param {string} text - Texto a ser exibido 
   * @param {boolean} isExternal - Se veio de fonte externa
   * @param {boolean} isInterim - Se é uma transcrição parcial/intermediária
   * @private
   */
  _showTranscriptionOnScreen(text, isExternal = false, isInterim = false) {
    // Verificar se o elemento já existe ou criar um novo
    let transcriptionDisplay = document.getElementById('debug-transcription-display');
    
    if (!transcriptionDisplay) {
      // Criar o elemento de exibição
      transcriptionDisplay = document.createElement('div');
      transcriptionDisplay.id = 'debug-transcription-display';
      
      // Estilizar o elemento
      Object.assign(transcriptionDisplay.style, {
        position: 'fixed',
        bottom: '20px',
        left: '20px',
        right: '20px',
        padding: '15px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        zIndex: '9999',
        borderRadius: '8px',
        fontFamily: 'Arial, sans-serif',
        maxHeight: '200px',
        overflowY: 'auto',
        fontSize: '14px',
        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
        transition: 'all 0.3s ease'
      });
      
      // Título e estrutura
      transcriptionDisplay.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
          <div style="font-weight: bold; color: #4CAF50;">Transcrições de Voz (Debug)</div>
          <div>
            <button id="debug-transcription-clear" style="background: #f44336; color: white; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; margin-left: 10px;">Limpar</button>
            <button id="debug-transcription-close" style="background: #555; color: white; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; margin-left: 5px;">X</button>
          </div>
        </div>
        <div id="debug-transcription-content"></div>
      `;
      
      // Adicionar ao body
      document.body.appendChild(transcriptionDisplay);
      
      // Adicionar event listeners
      document.getElementById('debug-transcription-clear').addEventListener('click', () => {
        document.getElementById('debug-transcription-content').innerHTML = '';
      });
      
      document.getElementById('debug-transcription-close').addEventListener('click', () => {
        document.body.removeChild(transcriptionDisplay);
      });
    }
    
    // Obter o contêiner de conteúdo
    const contentContainer = document.getElementById('debug-transcription-content');
    
    // Criar novo item de transcrição
    const transcriptionItem = document.createElement('div');
    transcriptionItem.style.marginBottom = '8px';
    transcriptionItem.style.borderLeft = isExternal 
      ? '3px solid #2196F3' // Azul para Whisper
      : '3px solid #4CAF50'; // Verde para WebSpeech
    transcriptionItem.style.paddingLeft = '10px';
    transcriptionItem.style.opacity = isInterim ? '0.7' : '1';
    transcriptionItem.style.fontStyle = isInterim ? 'italic' : 'normal';
    
    // Fonte e timestamp
    const source = isExternal ? 'Whisper' : 'WebSpeech';
    const time = new Date().toLocaleTimeString();
    
    // Montar o HTML
    transcriptionItem.innerHTML = `
      <div style="color: ${isExternal ? '#2196F3' : '#4CAF50'}; font-size: 11px; margin-bottom: 2px;">
        ${source} ${isInterim ? '(parcial)' : ''} - ${time}
      </div>
      <div>${text}</div>
    `;
    
    // Adicionar ao contêiner
    contentContainer.appendChild(transcriptionItem);
    
    // Limitar o número máximo de itens (manter os 10 mais recentes)
    while (contentContainer.children.length > 10) {
      contentContainer.removeChild(contentContainer.children[0]);
    }
    
    // Rolar para o final
    contentContainer.scrollTop = contentContainer.scrollHeight;
  }

  // Método para verificar duplicações de palavras
  _checkForDuplication(text) {
    if (!text) return false;
    
    // Primeiro padrão: palavras repetidas sequencialmente (ex: "olá olá")
    const words = text.trim().split(/\s+/);
    if (words.length < 2) return false;
    
    // Verificar padrões de duplicação
    
    // Padrão 1: Palavra única repetida (ex: "Olá Olá")
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i].toLowerCase() === words[i+1].toLowerCase() && words[i].length > 2) {
        return true;
      }
    }
    
    // Padrão 2: Frases repetidas (ex: "como vai você como vai você")
    if (words.length >= 4) {
      const half = Math.floor(words.length / 2);
      // Verificar se a primeira metade é igual à segunda metade
      for (let i = 0; i < half; i++) {
        if (words[i].toLowerCase() !== words[i+half].toLowerCase()) {
          return false;
        }
      }
      // Se chegamos aqui e temos 4+ palavras, provavelmente é uma duplicação
      if (words.length >= 4) {
        return true;
      }
    }
    
    return false;
  }

  // Método para remover duplicações
  _removeDuplication(text) {
    if (!text) return text;
    
    const words = text.trim().split(/\s+/);
    if (words.length < 2) return text;
    
    // Caso 1: Palavra repetida sequencialmente
    const uniqueWords = [];
    for (let i = 0; i < words.length; i++) {
      // Se não for igual à próxima OU for a última palavra, adicionar
      if (i === words.length - 1 || words[i].toLowerCase() !== words[i+1].toLowerCase()) {
        uniqueWords.push(words[i]);
      }
    }
    
    // Caso 2: Frase repetida (primeira metade igual à segunda)
    if (uniqueWords.length >= 4) {
      const half = Math.floor(uniqueWords.length / 2);
      let isRepeatedPhrase = true;
      
      // Verificar se a primeira metade é igual à segunda
      for (let i = 0; i < half; i++) {
        if (uniqueWords[i].toLowerCase() !== uniqueWords[i+half].toLowerCase()) {
          isRepeatedPhrase = false;
          break;
        }
      }
      
      // Se for uma frase repetida, ficar apenas com a primeira metade
      if (isRepeatedPhrase) {
        return uniqueWords.slice(0, half).join(' ');
      }
    }
    
    return uniqueWords.join(' ');
  }

  // Método auxiliar para salvar transcrição no servidor
  _saveTranscription(transcript) {
    try {
      // Verificações mais rigorosas
      if (!transcript || typeof transcript !== 'string') {
        console.warn('HybridAI: Transcrição vazia ou inválida, ignorando');
        return;
      }
      
      // Remover espaços em branco extras e normalizar
      const normalizedTranscript = transcript.trim();
      
      // Verificar se o texto é muito curto para economizar chamadas ao servidor
      if (normalizedTranscript.length < 2) {
        console.warn(`HybridAI: Transcrição muito curta (${normalizedTranscript.length} caracteres), ignorando`);
        return;
      }
      
      // Garantir que temos um sessionId
      if (!this.sessionId) {
        this.sessionId = this.extractSessionId();
      }
      
      // Verificação mínima do sessionId - apenas verificar se temos alguma coisa
      if (!this.sessionId || this.sessionId.length < 3) {
        console.warn('HybridAI: ID da sessão completamente inválido ou vazio, transcrição não será salva', this.sessionId);
        return;
      }
      
      // Em ambiente de desenvolvimento, logar uso de IDs temporários
      const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1');
      if (isDevelopment && this.sessionId.startsWith('temp_')) {
        console.log('HybridAI: Usando ID temporário em ambiente de desenvolvimento:', this.sessionId);
      } else if (this.sessionId.startsWith('temp_')) {
        // Em produção, logar o uso de temporários mas permitir
        console.warn('HybridAI: Usando ID temporário em produção:', this.sessionId);
      }
      
      console.log(`HybridAI: Preparando para salvar transcrição. SessionID: ${this.sessionId}, Tamanho do texto: ${normalizedTranscript.length} caracteres`);
      
      // Verificar token antes de tentar salvar
      const authToken = this.getAuthToken();
      if (!authToken) {
        console.warn('HybridAI: Token de autenticação não encontrado, transcrição não será salva');
        // Não disparar evento de erro aqui para evitar mensagens duplicadas
        return;
      }
      
      // Enviar para o servidor em background
      this.sendTranscriptionToServer(normalizedTranscript, this.emotions)
        .then(() => console.log('HybridAI: Transcrição salva com sucesso'))
        .catch(err => {
          if (!err.message?.includes('401') && !err.message?.includes('403') && !err.message?.includes('autenticação')) {
            console.error('HybridAI: Erro ao salvar transcrição:', err);
          }
        });
        
    } catch (e) {
      console.error('HybridAI: Erro ao processar salvamento da transcrição:', e);
    }
  }

  // Processamento em segundo plano
  _processBackgroundTasks(transcript) {
    try {
      // Processar emoções se o texto for longo o suficiente
      if (transcript && transcript.length > 5) {
        this.processEmotions(transcript);
      }
    } catch (e) {
      console.error('HybridAI: Erro ao processar tarefas em background:', e);
    }
  }

  // Registrar eventos de tecla para controle do usuário
  handleKeyEvents() {
    try {
      // Configurar eventos de teclado para controlar o reconhecimento
      document.addEventListener('keydown', (event) => {
        // Tecla Esc para parar o reconhecimento
        if (event.key === 'Escape') {
          console.log('HybridAI: Tecla Escape pressionada, parando reconhecimento');
          this.stopRecording();
        }
      });
      
      console.log('HybridAI: Eventos de teclado registrados');
      return true;
    } catch (e) {
      console.error('HybridAI: Erro ao configurar eventos de teclado:', e);
      return false;
    }
  }

  /**
   * Iniciar o timer de inatividade para pausar reconhecimento após período sem fala
   * @private
   */
  _startInactivityTimer() {
    this._clearInactivityTimer();
    
    // Garantir que a variável existe
    if (!this.lastSpeechTimestamp) {
      this.lastSpeechTimestamp = Date.now();
    }
    
    this.inactivityTimer = setTimeout(() => {
      const timeSinceLastSpeech = Date.now() - this.lastSpeechTimestamp;
      
      if (timeSinceLastSpeech >= this.inactivityThreshold) {
        console.log(`HybridAI: Inatividade de ${Math.round(timeSinceLastSpeech/1000)}s detectada, pausando reconhecimento`);
        
        // Marcar como pausado por inatividade
        this.pausedByInactivity = true;
        
        // Parar o reconhecimento atual (será reiniciado no modo de espera)
        if (this.recognition && (this.recognition.state === 'running' || this.isProcessingSpeech)) {
          try {
            this.recognition.stop();
          } catch (e) {
            console.warn('HybridAI: Erro ao pausar reconhecimento por inatividade:', e);
          }
        }
      } else {
        // Continuar verificando inatividade
        this._startInactivityTimer();
      }
    }, Math.max(1000, this.inactivityThreshold / 2)); // Verificar na metade do tempo de inatividade
  }

  // Resetar o timer de inatividade
  _resetInactivityTimer() {
    this._clearInactivityTimer();
    
    if (this.pauseAfterInactivity && this.isListening && !this.stopRequested) {
      this._startInactivityTimer();
    }
  }

  // Limpar o timer de inatividade
  _clearInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  /**
   * Processa uma transcrição externa recebida do Whisper ou outro serviço
   * @param {string} transcript - A transcrição recebida do serviço externo
   * @param {string} fullText - O texto completo da sessão (acumulado)
   * @param {string} sessionId - ID da sessão
   * @returns {Promise<void>}
   */
  async processExternalTranscription(transcript, fullText, sessionId = null) {
    try {
      console.log('HybridAI: Processando transcrição externa do Whisper');
      console.log(`HybridAI: Texto recebido (${transcript.length} caracteres)`);
      
      // Atualizar o sessionId se fornecido
      if (sessionId && !this.sessionId) {
        this.sessionId = sessionId;
        console.log(`HybridAI: SessionId atualizado: ${sessionId}`);
      }
      
      // Atualizar texto completo
      this.fullSessionText = fullText || transcript;
      
      // Verificar texto por segurança
      if (!transcript || transcript.length < 3) {
        console.warn('HybridAI: Transcrição externa vazia ou muito curta, ignorando');
        return;
      }
      
      // Processar a transcrição como se fosse final (a transcrição do Whisper já é final)
      await this._handleFinalSpeechResult(transcript, true);
      
      // Disparar evento customizado para interface
      window.dispatchEvent(new CustomEvent('external-transcription-processed', {
        detail: { 
          transcript, 
          source: 'whisper',
          sessionId: this.sessionId,
          timestamp: new Date().toISOString()
        }
      }));
      
      console.log('HybridAI: Transcrição externa processada com sucesso');
    } catch (error) {
      console.error('HybridAI: Erro ao processar transcrição externa:', error);
    }
  }
}

// Exportar instância única do serviço
export default new HybridAIService(); 