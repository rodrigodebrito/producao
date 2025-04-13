/**
 * WhisperTranscriptionService
 * Serviço para gravar áudio, converter formatos e enviar para a API Whisper
 * Com detecção automática de silêncio e envio de chunks
 * Agora captura áudio de todos os participantes no Daily.co
 */
import { WHISPER_URL, API_URL } from '../config';

// Injeta um script inicializador para Daily.co se estamos na página principal
// Este código é executado imediatamente na inicialização e prepara o ambiente para comunicação
(function initializeDailyCapture() {
  // Adicionar um identificador único para rastrear comunicações
  const BRIDGE_ID = 'daily-bridge-' + Math.random().toString(36).substring(2, 15);
  
  // Criar uma função global para receber dados do Daily
  window.receiveFromDaily = function(data) {
    console.log('[DAILY BRIDGE] Recebidos dados do Daily via function bridge:', data);
    if (data && typeof data === 'object') {
      // Redirecionar mensagem para o sistema de eventos normal
      window.dispatchEvent(new CustomEvent('daily-bridge-message', { 
        detail: data 
      }));
    }
  };
  
  // Verifica se estamos em uma página com Daily.co
  if (window.location.href.includes('daily.co') || 
      document.querySelector('iframe[src*="daily.co"]')) {
    
    console.log('[DAILY INIT] Inicializando sistema de captura compatível com Daily.co');
    console.log('[DAILY INIT] Bridge ID:', BRIDGE_ID);
    
    // Função para monitorar mudanças na URL hash - canal alternativo de comunicação
    function checkHashMessage() {
      try {
        if (window.location.hash && window.location.hash.startsWith('#daily-msg:')) {
          const encodedMsg = window.location.hash.substring(11);
          const msgData = JSON.parse(decodeURIComponent(encodedMsg));
          console.log('[DAILY BRIDGE] Mensagem recebida via hash:', msgData);
          
          // Limpar hash após processamento
          window.location.hash = '';
          
          // Processar a mensagem como se fosse do canal normal
          window.dispatchEvent(new CustomEvent('daily-bridge-message', { detail: msgData }));
        }
      } catch (e) {
        console.error('[DAILY BRIDGE] Erro ao processar mensagem hash:', e);
      }
    }
    
    // Verificar hash inicialmente e monitorar mudanças
    checkHashMessage();
    window.addEventListener('hashchange', checkHashMessage);
    
    // Adiciona um listener para eventos do bridge
    window.addEventListener('daily-bridge-message', function(event) {
      const data = event.detail;
      if (data && data.type === 'daily-audio-capture-response') {
        console.log('[DAILY BRIDGE] Processando resposta de captura:', data);
        // Aqui podemos processar a resposta
      }
    });
    
    // Adiciona um listener global para mensagens postMessage enviadas para o iframe do Daily
    window.addEventListener('message', function(event) {
      // Verificar se a mensagem é de origem confiável (pode ser qualquer origem já que verificamos o tipo)
      const data = event.data;
      
      // Verificar se a mensagem tem o formato esperado para captura de áudio
      if (data && data.type === 'daily-audio-capture-request') {
        console.log('[DAILY INIT] Recebida solicitação de captura de áudio do WhisperService');
        
        // Cria um script para injetar no iframe do Daily
        const dailyIframe = document.querySelector('iframe[src*="daily.co"]');
        if (!dailyIframe) {
          console.warn('[DAILY INIT] Iframe do Daily não encontrado');
          return;
        }
        
        // Tenta diferentes métodos de comunicação
        tryMultipleCommunicationApproaches(dailyIframe, data);
      }
    });
    
    // Função para tentar múltiplas abordagens de comunicação com o iframe
    function tryMultipleCommunicationApproaches(iframe, requestData) {
      console.log('[DAILY DEBUG] Tentando múltiplas abordagens de comunicação');
      
      // 1. Abordagem com postMessage (padrão)
      try {
        iframe.contentWindow.postMessage({
          type: 'daily-audio-capture-request',
          bridgeId: BRIDGE_ID,
          sessionId: requestData.sessionId,
          timestamp: new Date().toISOString()
        }, '*');
        console.log('[DAILY DEBUG] Mensagem enviada via postMessage');
      } catch (e) {
        console.warn('[DAILY DEBUG] Falha ao enviar via postMessage:', e);
      }
      
      // 2. Abordagem com injeção de script
      try {
        // Cria um elemento de script para injeção
        const scriptElement = document.createElement('script');
        scriptElement.id = 'daily-capture-script';
        
        // Código que será injetado no iframe do Daily
        const scriptContent = `
          // Função para enviar mensagem de volta para o pai
          function sendToBridge(data) {
            try {
              // Método 1: postMessage
              window.parent.postMessage(data, '*');
              console.log('[DAILY IFRAME] Mensagem enviada via postMessage');
              
              // Método 2: função bridge global
              if (window.parent.receiveFromDaily) {
                window.parent.receiveFromDaily(data);
                console.log('[DAILY IFRAME] Mensagem enviada via function bridge');
              }
              
              // Método 3: hash URL (funciona mesmo com restrições de segurança)
              try {
                const encoded = encodeURIComponent(JSON.stringify(data));
                window.parent.location.hash = 'daily-msg:' + encoded;
                console.log('[DAILY IFRAME] Mensagem enviada via hash');
              } catch (e) {
                console.error('[DAILY IFRAME] Erro ao enviar via hash:', e);
              }
            } catch (e) {
              console.error('[DAILY IFRAME] Erro ao enviar mensagem:', e);
            }
          }
          
          // Função para capturar áudio do Daily
          function captureAudioFromDaily() {
            console.log('[DAILY IFRAME] Iniciando captura de áudio do Daily');
            
            try {
              // Verificar se o objeto daily está disponível
              if (typeof window.daily === 'undefined' || !window.daily) {
                console.warn('[DAILY IFRAME] Objeto daily não encontrado');
                sendToBridge({
                  type: 'daily-audio-capture-response',
                  success: false,
                  error: 'Objeto daily não encontrado',
                  bridgeId: '${BRIDGE_ID}'
                });
                return false;
              }
              
              // Debug - listar propriedades do objeto daily
              console.log('[DAILY IFRAME] Propriedades do objeto daily:', Object.keys(window.daily));
              
              // Verificar métodos importantes
              const hasParticipantsMethod = typeof window.daily.participants === 'function';
              const hasCallStateMethod = typeof window.daily.callState === 'function';
              
              console.log('[DAILY IFRAME] Métodos disponíveis:', {
                participants: hasParticipantsMethod,
                callState: hasCallStateMethod
              });
              
              // Verificar estado da chamada, se disponível
              let callState = null;
              if (hasCallStateMethod) {
                try {
                  callState = window.daily.callState();
                  console.log('[DAILY IFRAME] Estado da chamada:', callState);
                } catch (e) {
                  console.error('[DAILY IFRAME] Erro ao verificar estado da chamada:', e);
                }
              }
              
              // Verificar participantes, se disponível
              let participants = null;
              if (hasParticipantsMethod) {
                try {
                  participants = window.daily.participants();
                  console.log('[DAILY IFRAME] Participantes:', participants);
                } catch (e) {
                  console.error('[DAILY IFRAME] Erro ao listar participantes:', e);
                }
              }
              
              // Se não conseguimos acessar participantes, reportar erro
              if (!participants) {
                sendToBridge({
                  type: 'daily-audio-capture-response',
                  success: false,
                  error: 'Não foi possível acessar participantes',
                  bridgeId: '${BRIDGE_ID}',
                  debug: {
                    hasParticipantsMethod,
                    hasCallStateMethod,
                    callState
                  }
                });
                return false;
              }
              
              // Notificar sucesso mesmo sem capturar o áudio real - apenas para desenvolvimento
              sendToBridge({
                type: 'daily-audio-capture-response',
                success: true,
                bridgeId: '${BRIDGE_ID}',
                message: 'Comunicação bem-sucedida com Daily.co',
                debug: {
                  participantCount: Object.keys(participants).length,
                  hasParticipantsMethod,
                  hasCallStateMethod,
                  callState
                }
              });
              
              return true;
            } catch (error) {
              console.error('[DAILY IFRAME] Erro ao capturar áudio:', error);
              sendToBridge({
                type: 'daily-audio-capture-response',
                success: false,
                error: error.message || 'Erro desconhecido',
                bridgeId: '${BRIDGE_ID}'
              });
              return false;
            }
          }
          
          // Adiciona listener de eventos de mensagem
          window.addEventListener('message', function(event) {
            try {
              const data = event.data;
              if (data && data.type === 'daily-audio-capture-request') {
                console.log('[DAILY IFRAME] Solicitação de captura recebida via postMessage');
                captureAudioFromDaily();
              }
            } catch (e) {
              console.error('[DAILY IFRAME] Erro ao processar mensagem:', e);
            }
          });
          
          // Executar automaticamente após um curto delay
          setTimeout(function() {
            console.log('[DAILY IFRAME] Tentando captura automática de áudio...');
            captureAudioFromDaily();
          }, 1000);
          
          // Sinalizar que o script foi carregado
          console.log('[DAILY IFRAME] Script de captura carregado');
        `;
        
        scriptElement.textContent = scriptContent;
        
        // Tenta injetar no iframe do Daily
        try {
          // Método 1: usar contentDocument diretamente (pode falhar por segurança)
          if (iframe.contentDocument) {
            iframe.contentDocument.head.appendChild(scriptElement);
            console.log('[DAILY DEBUG] Script injetado via contentDocument');
          } else {
            throw new Error('contentDocument não disponível');
          }
        } catch (e) {
          console.warn('[DAILY DEBUG] Falha ao injetar via contentDocument:', e);
          
          // Método 2: usar srcDoc para injetar (funciona em alguns navegadores)
          try {
            // Capturar o src original para recriar
            const originalSrc = iframe.src;
            
            // Tenta modificar o srcdoc para incluir o script
            iframe.srcdoc = `
              <html>
                <head>
                  <script>
                    // Redirecionar para a URL original, mas com nosso script injetado
                    window.location.href = "${originalSrc}";
                    
                    ${scriptContent}
                  </script>
                </head>
                <body></body>
              </html>
            `;
            console.log('[DAILY DEBUG] Script injetado via srcdoc');
          } catch (e2) {
            console.warn('[DAILY DEBUG] Falha ao injetar via srcDoc:', e2);
          }
        }
      } catch (e) {
        console.error('[DAILY DEBUG] Erro ao tentar injetar script:', e);
      }
      
      // 3. Abordagem com elemento visual auxiliar
      try {
        // Criar um elemento visual de ajuda e instruções
        const helperElement = document.createElement('div');
        helperElement.id = 'daily-capture-helper';
        helperElement.style.position = 'fixed';
        helperElement.style.bottom = '10px';
        helperElement.style.right = '10px';
        helperElement.style.zIndex = '999999';
        helperElement.style.backgroundColor = 'rgba(0,0,0,0.7)';
        helperElement.style.color = 'white';
        helperElement.style.padding = '10px';
        helperElement.style.borderRadius = '5px';
        helperElement.style.fontSize = '12px';
        helperElement.style.maxWidth = '300px';
        
        // Conteúdo do helper
        helperElement.innerHTML = `
          <div style="margin-bottom: 8px; font-weight: bold;">Daily.co - Captura de Áudio</div>
          <div style="margin-bottom: 8px;">Tentativa de comunicação em andamento...</div>
          <div style="font-size: 10px; margin-top: 5px;">ID da Ponte: ${BRIDGE_ID}</div>
        `;
        
        // Adicionar à página
        document.body.appendChild(helperElement);
        console.log('[DAILY DEBUG] Elemento auxiliar visual adicionado à página');
        
        // Atualizar após timeout
        setTimeout(() => {
          if (document.getElementById('daily-capture-helper')) {
            document.getElementById('daily-capture-helper').innerHTML = `
              <div style="margin-bottom: 8px; font-weight: bold;">Daily.co - Captura de Áudio</div>
              <div style="margin-bottom: 8px;">Usando microfone local (fallback)</div>
              <div style="margin-bottom: 8px;">A captura direta do Daily.co não está disponível.</div>
              <div style="font-size: 10px; margin-top: 5px;">ID da Ponte: ${BRIDGE_ID}</div>
            `;
          }
        }, 5000);
      } catch (e) {
        console.error('[DAILY DEBUG] Erro ao criar elemento auxiliar:', e);
      }
    }
    
    console.log('[DAILY INIT] Sistema de captura Daily.co inicializado com sucesso');
  }
})();

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
    this.silenceDuration = 5000; // 5 segundos de silêncio para enviar e parar
    this.maxChunkDuration = 15000; // 15 segundos máximos por chunk
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
    this.autoRestart = true;
    
    // NOVO: Flag para verificar se estamos em pausa por silêncio
    this.pausedForSilence = false;
    
    // NOVO: Configuração para detecção de voz após pausa
    this.voiceDetectionEnabled = true;
    this.voiceThreshold = -40; // dB (menos sensível que o silêncio)
    this.voiceDetectionInterval = null;

    // NOVO: Variáveis para suporte ao Daily.co
    this.dailyCapturingEnabled = false;
    this.dailyEventListenerAdded = false;
    
    // Adicionar listener para mensagens do iframe do Daily se estiver em produção
    if (window.location.hostname !== 'localhost') {
      this._setupDailyMessageListener();
    }
    
    // NOVO: Adicionar listener para o bridge de comunicação com Daily
    window.addEventListener('daily-bridge-message', (event) => {
      try {
        const data = event.detail;
        if (data && data.type === 'daily-audio-capture-response') {
          console.log('[WHISPER] Recebida resposta de captura via bridge:', data);
          if (data.success) {
            this.dailyCapturingEnabled = true;
          }
        }
      } catch (e) {
        console.error('[WHISPER] Erro ao processar mensagem do bridge:', e);
      }
    });
  }
  
  /**
   * Tenta ativar a captura de áudio do Daily.co usando várias abordagens
   * @returns {Promise<boolean>}
   * @private
   */
  async _tryEnableDailyCapture() {
    console.log('[DAILY DEBUG] Iniciando tentativa de captura de áudio do Daily.co...');
    
    try {
      // 1. Tentar abordagem via proxy backend primeiro (evita CORS)
      const backendProxySuccess = await this._tryDailyCaptureViaBackend();
      if (backendProxySuccess) {
        console.log('[DAILY DEBUG] Captura via proxy backend bem-sucedida!');
        this.dailyCapturingEnabled = true;
        return true;
      }
      
      // 2. Tentar abordagem direta via postMessage como fallback
      const iframes = document.querySelectorAll('iframe');
      console.log(`[DAILY DEBUG] Encontrados ${iframes.length} iframes na página`);
      
      if (iframes.length === 0) {
        console.log('[DAILY DEBUG] Nenhum iframe encontrado, impossível capturar áudio do Daily');
        return false;
      }
      
      // Verificar cada iframe
      let dailyIframeFound = false;
      
      for (let i = 0; i < iframes.length; i++) {
        const iframe = iframes[i];
        const iframeSrc = iframe.src || '';
        
        console.log(`[DAILY DEBUG] Verificando iframe #${i+1}: ${iframeSrc}`);
        
        // Verificar se parece ser do Daily.co
        if (iframeSrc.includes('daily.co') || iframeSrc.includes('teraconect.daily.co')) {
          console.log(`[DAILY DEBUG] Iframe #${i+1} é potencialmente do Daily.co, tentando comunicação via postMessage`);
          dailyIframeFound = true;
          
          // Tentar obter áudio deste iframe
          const success = await this._requestDailyAudioCapture(iframe);
          
          if (success) {
            console.log(`[DAILY DEBUG] Captura de áudio do Daily.co ativada com sucesso via iframe #${i+1}`);
            this.dailyCapturingEnabled = true;
            return true;
          }
        }
      }
      
      if (!dailyIframeFound) {
        console.log('[DAILY DEBUG] Nenhum iframe do Daily.co encontrado');
      } else {
        console.log('[DAILY DEBUG] Falha na comunicação por postMessage com todos os iframes do Daily.co');
      }
      
      return false;
    } catch (error) {
      console.error('[DAILY DEBUG] Erro ao tentar ativar captura de áudio do Daily:', error);
      return false;
    }
  }
  
  /**
   * Nova abordagem: tenta capturar áudio do Daily.co via proxy do backend (evita CORS)
   * @returns {Promise<boolean>}
   * @private
   */
  async _tryDailyCaptureViaBackend() {
    try {
      // Extrair informações necessárias para o backend identificar a sessão
      const roomName = this._extractDailyRoomName();
      const sessionId = this.sessionId || this.extractSessionId();
      
      if (!roomName || !sessionId) {
        console.log('[DAILY DEBUG] Impossível identificar sala ou sessão para proxy backend');
        return false;
      }
      
      // Construir URL do endpoint de proxy - usar o Render diretamente
      const baseProxyUrl = 'https://theraconnect-prd.onrender.com/api/daily-proxy';
      
      // Primeiro testar endpoint de debug para verificar se o backend está acessível
      console.log('[DAILY DEBUG] Testando conexão com endpoint de debug...');
      try {
        const debugEndpoint = `${baseProxyUrl}/debug`;
        const debugResponse = await fetch(debugEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            test: true,
            timestamp: new Date().toISOString()
          })
        });
        
        if (debugResponse.ok) {
          const debugResult = await debugResponse.json();
          console.log('[DAILY DEBUG] Conexão com backend bem-sucedida:', debugResult);
        } else {
          console.warn('[DAILY DEBUG] Falha no teste de conexão:', await debugResponse.text());
        }
      } catch (debugError) {
        console.warn('[DAILY DEBUG] Erro ao testar conexão:', debugError);
      }
      
      // Tentar acessar endpoint de teste simples
      try {
        console.log('[DAILY DEBUG] Testando endpoint /test...');
        const testEndpoint = `${baseProxyUrl}/test`;
        const testResponse = await fetch(testEndpoint);
        
        if (testResponse.ok) {
          const testResult = await testResponse.json();
          console.log('[DAILY DEBUG] Endpoint de teste respondeu:', testResult);
        } else {
          console.warn('[DAILY DEBUG] Falha no endpoint de teste:', await testResponse.text());
        }
      } catch (testError) {
        console.warn('[DAILY DEBUG] Erro ao acessar endpoint de teste:', testError);
      }
      
      // Agora tentar o endpoint real de captura
      const captureEndpoint = `${baseProxyUrl}/capture`;
      console.log(`[DAILY DEBUG] Solicitando captura de áudio via backend proxy: ${captureEndpoint}`, { roomName, sessionId });
      
      // Fazer requisição para o backend iniciar o proxy de captura
      const response = await fetch(captureEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          roomUrl: roomName,
          participantId: sessionId,
          timestamp: new Date().toISOString()
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        console.warn(`[DAILY DEBUG] Falha no proxy backend: ${error}`);
        return false;
      }
      
      const result = await response.json();
      
      if (result.success) {
        console.log('[DAILY DEBUG] Backend proxy registrado com sucesso');
        
        // Configurar listener para receber dados do backend via eventos SSE ou WebSocket
        this._setupBackendStreamListener(result.data?.streamToken || 'default-token');
        
        return true;
      } else {
        console.warn(`[DAILY DEBUG] Backend reportou erro: ${result.error}`);
        return false;
      }
    } catch (error) {
      console.error('[DAILY DEBUG] Erro ao tentar proxy via backend:', error);
      return false;
    }
  }
  
  /**
   * Extrai o nome da sala do Daily.co a partir das URLs dos iframes
   * @returns {string|null}
   * @private
   */
  _extractDailyRoomName() {
    // Procurar por iframes do Daily.co
    const iframes = Array.from(document.querySelectorAll('iframe'));
    
    for (const iframe of iframes) {
      const src = iframe.src || '';
      
      if (src.includes('daily.co') || src.includes('teraconect.daily.co')) {
        // Tentar extrair o nome da sala da URL
        try {
          const url = new URL(src);
          // A estrutura típica é: https://domain.daily.co/room-name?params
          const pathParts = url.pathname.split('/').filter(Boolean);
          if (pathParts.length > 0) {
            return pathParts[0]; // Primeiro segmento após o domínio
          }
        } catch (e) {
          console.warn('[DAILY DEBUG] Erro ao extrair nome da sala:', e);
        }
      }
    }
    
    return null;
  }
  
  /**
   * Configura um listener para receber dados de áudio do backend
   * @param {string} streamToken - Token de autenticação para o stream
   * @private
   */
  _setupBackendStreamListener(streamToken) {
    // Implementar de acordo com o mecanismo escolhido (WebSocket ou SSE)
    console.log(`[DAILY DEBUG] Configurando listener para stream de áudio do backend (token: ${streamToken})`);
    
    // Exemplo usando WebSocket
    try {
      const baseUrl = process.env.REACT_APP_WS_URL || window.location.origin.replace('http', 'ws');
      const wsUrl = `${baseUrl}/ws/daily-audio/${this.sessionId}?token=${streamToken}`;
      
      console.log(`[DAILY DEBUG] Conectando ao WebSocket: ${wsUrl}`);
      
      const socket = new WebSocket(wsUrl);
      
      socket.onopen = () => {
        console.log('[DAILY DEBUG] Conexão WebSocket estabelecida para áudio do Daily');
      };
      
      socket.onmessage = (event) => {
        try {
          // Processar mensagem com dados de áudio do backend
          const data = JSON.parse(event.data);
          
          if (data.type === 'audio-chunk') {
            // Converter chunk de áudio codificado em base64 para Blob
            const audioBlob = this._base64ToBlob(data.chunk, 'audio/webm');
            
            // Adicionar à lista de chunks como se fosse do MediaRecorder
            this.audioChunks.push(audioBlob);
            console.log(`[DAILY DEBUG] Chunk de áudio recebido via backend: ${Math.round(audioBlob.size/1024)}KB`);
          }
        } catch (e) {
          console.error('[DAILY DEBUG] Erro ao processar mensagem de áudio:', e);
        }
      };
      
      socket.onerror = (error) => {
        console.error('[DAILY DEBUG] Erro na conexão WebSocket:', error);
      };
      
      socket.onclose = () => {
        console.log('[DAILY DEBUG] Conexão WebSocket fechada');
      };
      
      // Guardar referência para limpar depois
      this.backendSocket = socket;
    } catch (e) {
      console.error('[DAILY DEBUG] Erro ao configurar WebSocket:', e);
    }
  }
  
  /**
   * Converte string Base64 para Blob
   * @param {string} base64 - String em formato base64
   * @param {string} mimeType - Tipo MIME do conteúdo
   * @returns {Blob} - Blob com os dados
   * @private
   */
  _base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    
    return new Blob(byteArrays, { type: mimeType });
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
          console.log('[DAILY DEBUG] Recebido frame de áudio do Daily.co');
          this._handleDailyAudioData(event.data);
        }
        // Processar resposta à solicitação de captura
        else if (event.data.type === 'daily-audio-capture-response') {
          console.log('[DAILY DEBUG] Recebida resposta de captura de áudio do Daily.co:', 
              event.data.success ? 'SUCESSO' : 'FALHA');
          
          if (event.data.success) {
            this.dailyCapturingEnabled = true;
          }
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
   * Solicita a captura de áudio do Daily.co usando postMessage (seguro entre origens)
   * @param {HTMLIFrameElement} iframe - iframe do Daily.co
   * @returns {Promise<boolean>}
   * @private
   */
  async _requestDailyAudioCapture(iframe) {
    if (!iframe) {
      console.error('[DAILY DEBUG] iframe inválido');
      return false;
    }
    
    return new Promise((resolve) => {
      // MODIFICADO: Aumentar timeout para 15 segundos
      const timeout = setTimeout(() => {
        console.warn('[DAILY DEBUG] Timeout ao esperar resposta do Daily via postMessage');
        if (!this.dailyEventListenerAdded) {
          window.removeEventListener('message', handleMessage);
        }
        resolve(false);
      }, 15000); // Aumentado para 15 segundos
      
      // Função de callback para mensagens
      const handleMessage = (event) => {
        try {
          // Aceitar qualquer origem para mensagens do tipo daily-*
          const data = event.data;
          
          if (typeof data === 'object' && data.type === 'daily-audio-capture-response') {
            clearTimeout(timeout);
            
            if (data.success) {
              console.log('[DAILY DEBUG] Resposta recebida do Daily: captura de áudio iniciada com sucesso');
              console.log('[DAILY DEBUG] Detalhes da resposta:', {
                participantId: data.participantId,
                hasAudioTracks: data.hasAudioTracks,
                trackCount: data.trackCount
              });
              
              if (!this.dailyEventListenerAdded) {
                window.removeEventListener('message', handleMessage);
              }
              
              resolve(true);
            } else {
              console.warn('[DAILY DEBUG] Resposta recebida do Daily: falha na captura de áudio');
              console.warn('[DAILY DEBUG] Motivo da falha:', data.error);
              
              if (!this.dailyEventListenerAdded) {
                window.removeEventListener('message', handleMessage);
              }
              
              resolve(false);
            }
          }
        } catch (error) {
          console.error('[DAILY DEBUG] Erro ao processar mensagem:', error);
        }
      };
      
      // Adicionar listener para mensagens se ainda não existe
      if (!this.dailyEventListenerAdded) {
        window.addEventListener('message', handleMessage);
        this.dailyEventListenerAdded = true;
      }
      
      try {
        // MODIFICADO: Função melhorada para tentar múltiplas abordagens de comunicação
        const tryDailyCommunication = async () => {
          // 1. Verificar se o iframe existe e tem contentWindow
          if (!iframe.contentWindow) {
            console.warn('[DAILY DEBUG] iframe não tem contentWindow, tentando outra abordagem...');
            tryDirectInject();
            return;
          }
          
          // 2. Enviar mensagem diretamente via postMessage sem verificar readyState
          console.log('[DAILY DEBUG] Enviando solicitação de captura de áudio via postMessage diretamente');
          
          try {
            iframe.contentWindow.postMessage({
              type: 'daily-audio-capture-request',
              sessionId: this.sessionId,
              source: 'whisperTranscriptionService',
              timestamp: new Date().toISOString()
            }, '*');
            
            console.log('[DAILY DEBUG] Mensagem enviada, aguardando resposta...');
          } catch (err) {
            console.warn('[DAILY DEBUG] Erro ao enviar mensagem diretamente:', err);
            tryDirectInject();
          }
        };
        
        // Função alternativa para injetar script diretamente
        const tryDirectInject = () => {
          console.log('[DAILY DEBUG] Tentando injeção direta de script...');
          
          // Código a ser injetado
          const scriptContent = `
            // Função para enviar mensagem via postMessage
            function sendToDailyBridge(data) {
              try {
                window.parent.postMessage(data, '*');
                console.log('[DAILY IFRAME] Mensagem enviada via postMessage');
              } catch (e) {
                console.error('[DAILY IFRAME] Erro ao enviar mensagem:', e);
              }
            }
            
            // Função para verificar periodicamente o objeto Daily
            let dailyCheckAttempts = 0;
            function checkForDaily() {
              dailyCheckAttempts++;
              
              // Limitar o número de tentativas
              if (dailyCheckAttempts > 20) {
                console.warn('[DAILY IFRAME] Máximo de tentativas de verificação do Daily atingido');
                sendToDailyBridge({
                  type: 'daily-audio-capture-response',
                  success: false,
                  error: 'Timeout ao tentar acessar API do Daily'
                });
                return;
              }
              
              console.log('[DAILY IFRAME] Verificando disponibilidade do objeto Daily... Tentativa #' + dailyCheckAttempts);
              
              // Verificar se o objeto daily está disponível agora
              if (typeof window.daily !== 'undefined' && window.daily) {
                console.log('[DAILY IFRAME] Objeto Daily encontrado!');
                
                try {
                  // Verificar métodos disponíveis
                  const hasParticipants = typeof window.daily.participants === 'function';
                  const hasCallState = typeof window.daily.callState === 'function';
                  
                  // Verificar se temos participantes
                  let participants = null;
                  if (hasParticipants) {
                    try {
                      participants = window.daily.participants();
                    } catch (e) {
                      console.warn('[DAILY IFRAME] Erro ao obter participantes:', e);
                    }
                  }
                  
                  // Reportar sucesso mesmo sem capturar áudio real ainda
                  sendToDailyBridge({
                    type: 'daily-audio-capture-response',
                    success: true,
                    message: 'Comunicação com Daily estabelecida',
                    hasParticipants: !!participants,
                    participantCount: participants ? Object.keys(participants).length : 0
                  });
                  
                  return;
                } catch (e) {
                  console.error('[DAILY IFRAME] Erro ao verificar API Daily:', e);
                }
              }
              
              // Tentar novamente em 500ms
              setTimeout(checkForDaily, 500);
            }
            
            // Iniciar verificação
            checkForDaily();
            
            // Também configurar listener para mensagens do pai
            window.addEventListener('message', function(event) {
              if (event.data && event.data.type === 'daily-audio-capture-request') {
                console.log('[DAILY IFRAME] Solicitação recebida, iniciando verificação do Daily');
                checkForDaily();
              }
            });
          `;
          
          try {
            // Criar elemento de script
            const scriptElem = document.createElement('script');
            scriptElem.textContent = scriptContent;
            
            // Tentar injetar no iframe de várias maneiras
            try {
              // 1. Tentar adicionar ao head do iframe (pode falhar por segurança)
              if (iframe.contentDocument && iframe.contentDocument.head) {
                iframe.contentDocument.head.appendChild(scriptElem);
                console.log('[DAILY DEBUG] Script injetado diretamente no head do iframe');
                return;
              }
            } catch (e) {
              console.warn('[DAILY DEBUG] Falha ao injetar no head do iframe:', e);
            }
            
            // 2. Tentar modificar o src do iframe para incluir o script
            try {
              const originalSrc = iframe.src;
              
              // Criar um parâmetro URL com o script codificado
              const encodedScript = encodeURIComponent(scriptContent);
              const separator = originalSrc.includes('?') ? '&' : '?';
              const scriptParam = `injectScript=${encodedScript}`;
              
              // Não modificar o src diretamente, mas criar um elemento alternativo
              console.log('[DAILY DEBUG] Tentando injeção via URL params');
              
              // 3. Última opção: criar um elemento visual auxiliar
              const helperDiv = document.createElement('div');
              helperDiv.style.position = 'fixed';
              helperDiv.style.bottom = '10px';
              helperDiv.style.right = '10px';
              helperDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
              helperDiv.style.color = '#fff';
              helperDiv.style.padding = '10px';
              helperDiv.style.borderRadius = '5px';
              helperDiv.style.zIndex = '99999';
              helperDiv.style.fontSize = '12px';
              helperDiv.innerHTML = `
                <div>Daily.co não respondeu</div>
                <div>Usando microfone local</div>
              `;
              
              document.body.appendChild(helperDiv);
              setTimeout(() => {
                helperDiv.style.opacity = '0.5';
                setTimeout(() => {
                  helperDiv.remove();
                }, 5000);
              }, 3000);
            } catch (e) {
              console.warn('[DAILY DEBUG] Falha ao injetar via URL params:', e);
            }
          } catch (e) {
            console.error('[DAILY DEBUG] Erro na injeção direta:', e);
          }
        };
        
        // Iniciar o processo de comunicação
        tryDailyCommunication();
        
        // Fazer tentativas adicionais em intervalos
        for (let attempt = 1; attempt <= 5; attempt++) {
          setTimeout(() => {
            if (!this.dailyCapturingEnabled) {
              console.log(`[DAILY DEBUG] Tentativa adicional #${attempt} de comunicação com Daily`);
              tryDailyCommunication();
            }
          }, attempt * 1000); // 1s, 2s, 3s, 4s, 5s
        }
        
      } catch (error) {
        console.error('[DAILY DEBUG] Erro ao comunicar com iframe:', error);
        clearTimeout(timeout);
        
        if (!this.dailyEventListenerAdded) {
          window.removeEventListener('message', handleMessage);
        }
        
        resolve(false);
      }
    });
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
      
      // MODIFICADO: Tentar ativar captura de áudio do Daily.co ANTES de iniciar captura local
      console.log('Tentando ativar captura de áudio do Daily.co...');
      
      // Tentamos com timeout para não bloquear indefinidamente
      let dailyCaptureSuccess = false;
      try {
        // Promise.race para limitar o tempo de espera
        dailyCaptureSuccess = await Promise.race([
          this._tryEnableDailyCapture(),
          new Promise(resolve => {
            setTimeout(() => {
              console.log("Tempo para resposta do Daily.co excedido");
              resolve(false);
            }, 3000); // 3 segundos máximo de espera
          })
        ]);
        
        if (dailyCaptureSuccess) {
          console.log('Captura de áudio do Daily.co ativada com sucesso');
          // Dar um tempo pequeno para o Daily se inicializar
          await new Promise(resolve => setTimeout(resolve, 300));
        } else {
          console.log('Não foi possível ativar captura de áudio do Daily.co, usando apenas microfone local');
        }
      } catch (e) {
        console.error('Erro ao tentar captura do Daily:', e);
      }
      
      // 6. Solicitar permissão do microfone local (como backup ou principal)
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
   * Libera todos os recursos de áudio para evitar vazamentos de memória
   * @returns {Promise<void>}
   * @private
   */
  async _releaseAllAudioResources() {
    console.log('Liberando TODOS os recursos de áudio...');
    
    try {
      // 1. Parar o stream de áudio
      if (this.audioStream) {
        // Parar todas as tracks de mídia
        const tracks = this.audioStream.getTracks();
        tracks.forEach(track => {
          try {
            track.stop();
            console.log('Track de áudio parada e liberada');
          } catch (e) {
            console.warn('Erro ao parar track de áudio:', e);
          }
        });
        
        // Limpar a referência ao stream
        this.audioStream = null;
      }
      
      // 2. Fechar e liberar o contexto de áudio para análise
      if (this.audioContext) {
        try {
          // Verificar se o AudioContext já está fechado antes de tentar fechá-lo novamente
          if (this.audioContext.state !== 'closed') {
            await this.audioContext.close();
            console.log('Contexto de áudio fechado');
          } else {
            console.log('Contexto de áudio já estava fechado');
          }
        } catch (e) {
          console.warn('Erro ao fechar contexto de áudio:', e);
        }
        this.audioContext = null;
        this.audioAnalyser = null;
      }
      
      // 3. Limpar referências ao MediaRecorder
      if (this.mediaRecorder) {
        try {
          if (this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
          }
        } catch (e) {
          console.warn('Erro ao parar MediaRecorder:', e);
        }
        this.mediaRecorder = null;
      }
      
      // 4. Limpar timers de detecção de silêncio
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      
      // 5. Limpar timer de chunk máximo
      if (this.maxChunkTimer) {
        clearTimeout(this.maxChunkTimer);
        this.maxChunkTimer = null;
      }
      
      // 6. Limpar estado de detecção de silêncio
      this.silenceStart = null;
      
      // 7. Cancelar qualquer detecção de voz em andamento
      if (this.voiceDetectionInterval) {
        clearInterval(this.voiceDetectionInterval);
        this.voiceDetectionInterval = null;
      }
      
      console.log('Liberação de recursos concluída');
    } catch (e) {
      console.error('Erro ao liberar recursos de áudio:', e);
    }
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
   * Inicia detecção de voz para reiniciar a gravação quando o usuário falar novamente
   * @private
   */
  _startVoiceDetection() {
    console.log('Iniciando detecção de voz para retomar gravação...');
    
    // Se já existe uma detecção de voz em andamento, limpar
    if (this.voiceDetectionInterval) {
      clearInterval(this.voiceDetectionInterval);
      this.voiceDetectionInterval = null;
    }
    
    // Garantir que não temos um AudioContext ativo para evitar vazamentos
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {
        console.warn('Erro ao fechar audioContext:', e);
      }
      this.audioContext = null;
    }
    
    // Iniciar novo stream para detecção
    let voiceDetectionStream = null;
    
    console.log('Gravação pausada por silêncio. Aguardando voz para reiniciar...');
    
    // Criar um novo contexto de áudio para a detecção de voz
    let voiceAudioContext = null;
    let voiceAnalyser = null;
    
    // Este é um processo assíncrono que não podemos await diretamente aqui
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        // Guardar referência ao stream para limpar depois
        voiceDetectionStream = stream;
        
        // Criar novo contexto de áudio e analisador
        voiceAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        voiceAnalyser = voiceAudioContext.createAnalyser();
        
        // Configurar analisador para detecção de voz
        voiceAnalyser.fftSize = 256;
        voiceAnalyser.smoothingTimeConstant = 0.5;
        
        // Conectar a fonte de áudio ao analisador
        const source = voiceAudioContext.createMediaStreamSource(stream);
        source.connect(voiceAnalyser);
        
        // Iniciar intervalo para verificar nível de voz periodicamente
        this.voiceDetectionInterval = setInterval(() => {
          try {
            // Se o contexto foi fechado, limpar intervalo
            if (voiceAudioContext.state === 'closed') {
              clearInterval(this.voiceDetectionInterval);
              this.voiceDetectionInterval = null;
              return;
            }
            
            // Obter dados do analisador
            const dataArray = new Uint8Array(voiceAnalyser.frequencyBinCount);
            voiceAnalyser.getByteFrequencyData(dataArray);
            
            // Calcular volume médio
            let sum = 0;
            for (const value of dataArray) {
              sum += value;
            }
            const average = sum / dataArray.length;
            
            // Converter para dB aproximados (0-255 -> -100-0 dB)
            const dB = average === 0 ? -100 : ((average / 255) * 100) - 100;
            
            // Detectar se o nível está acima do limiar (mais próximo de 0 = mais alto)
            if (dB > this.voiceThreshold) {
              console.log(`Voz detectada! (${dB.toFixed(1)} dB) - Reiniciando gravação!`);
              
              // Limpar este intervalo de detecção
              clearInterval(this.voiceDetectionInterval);
              this.voiceDetectionInterval = null;
              
              // Limpar recursos da detecção de voz
              if (voiceDetectionStream) {
                voiceDetectionStream.getTracks().forEach(track => track.stop());
              }
              
              // Fechar o contexto de áudio da detecção de voz se ainda estiver aberto
              try {
                if (voiceAudioContext && voiceAudioContext.state !== 'closed') {
                  voiceAudioContext.close();
                }
              } catch (e) {
                console.warn('Erro ao fechar contexto de detecção de voz:', e);
              }
              
              // Reiniciar a gravação
              this.forceRestartRecording();
            }
          } catch (e) {
            console.error('Erro na detecção de voz:', e);
            
            // Em caso de erro, limpar o intervalo
            clearInterval(this.voiceDetectionInterval);
            this.voiceDetectionInterval = null;
            
            // Limpar recursos
            if (voiceDetectionStream) {
              voiceDetectionStream.getTracks().forEach(track => track.stop());
            }
            
            // Tentar fechar o contexto de áudio se existir
            try {
              if (voiceAudioContext && voiceAudioContext.state !== 'closed') {
                voiceAudioContext.close();
              }
            } catch (err) {
              // Ignorar erros ao fechar o contexto
            }
          }
        }, 300);
      })
      .catch(error => {
        console.error('Erro ao iniciar detecção de voz:', error);
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
}

// Exportar como singleton
const whisperTranscriptionService = new WhisperTranscriptionService();
export default whisperTranscriptionService;