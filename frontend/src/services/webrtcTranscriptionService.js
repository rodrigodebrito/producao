/**
 * Serviço de transcrição baseado em WebRTC
 * Gerencia a captura de áudio de todos os participantes e envia para transcrição no backend
 */

import axios from 'axios';
import { API_URL } from '../config';

/**
 * Classe para gerenciar conexão WebRTC e transcrição
 */
class WebRTCTranscriptionService {
  constructor() {
    this.socket = null;
    this.sessionId = null;
    this.peerConnections = new Map();
    this.localStream = null;
    this.remoteStreams = new Map();
    this.isRecording = false;
    this.recordingStartTime = null;
    this.transcriptionCallback = null;
    this.isInitialized = false;
    this.connectionStatus = 'disconnected';
    this.participantIds = new Set();
    this.localAudioEnabled = false;
    
    // Configuração ICE para WebRTC
    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };
    
    // Logs para debug de API
    console.log('WebRTC: URL da API configurada como:', API_URL);
  }
  
  /**
   * Obtém o token de autenticação do localStorage
   * @private
   * @returns {string|null} Token de autenticação ou null se não encontrado
   */
  _getAuthToken() {
    try {
      // Verificar em ordem de preferência, similar a outros serviços
      const token = localStorage.getItem('authToken') || 
                   sessionStorage.getItem('authToken') || 
                   localStorage.getItem('token') || 
                   sessionStorage.getItem('token');
      
      if (!token) {
        console.warn('WebRTC: Token de autenticação não encontrado');
      } else {
        console.log('WebRTC: Token de autenticação encontrado');
      }
      
      return token;
    } catch (error) {
      console.error('WebRTC: Erro ao obter token de autenticação:', error);
      return null;
    }
  }
  
  /**
   * Cria um objeto de configuração para requisições HTTP com autenticação
   * @private
   * @returns {Object} Configuração para requisição HTTP
   */
  _getRequestConfig() {
    const token = this._getAuthToken();
    const config = {
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    } else {
      console.warn('WebRTC: Token de autenticação não encontrado');
    }
    
    return config;
  }
  
  /**
   * Constrói uma URL de API correta, evitando duplicação de /api
   * @param {string} path - Caminho relativo da API (sem /api inicial)
   * @returns {string} URL completa e correta para a API
   * @private
   */
  _buildApiUrl(path) {
    // Remover barras iniciais duplicadas se existirem
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;
    
    // Construir URL corretamente com base na configuração de API_URL
    if (API_URL.endsWith('/api')) {
      return `${API_URL}/${cleanPath}`;
    } else if (API_URL.includes('/api/')) {
      return `${API_URL.split('/api/')[0]}/api/${cleanPath}`;
    } else {
      return `${API_URL}/api/${cleanPath}`;
    }
  }
  
  /**
   * Inicializa o serviço
   * @param {string} sessionId - ID da sessão
   * @param {Object} socket - Socket.IO
   * @param {Function} transcriptionCallback - Callback para receber transcrições
   */
  async initialize(sessionId, socket, transcriptionCallback) {
    if (this.isInitialized) {
      console.log('WebRTC já inicializado. Reiniciando...');
      this.cleanup();
    }
    
    try {
      this.sessionId = sessionId;
      this.socket = socket;
      this.transcriptionCallback = transcriptionCallback;
      
      console.log(`WebRTC: Iniciando para sessão ${sessionId}`);
      
      // Inicializar sessão no backend
      await this._initializeServerSession();
      
      // Obter ID do participante local (usando socket.id ou gerando um UUID)
      this.localParticipantId = socket ? socket.id : this._generateUUID();
      console.log(`WebRTC: ID do participante local definido como ${this.localParticipantId}`);
      
      // Registrar explicitamente o participante local no backend
      await this._registerParticipant(this.localParticipantId);
      
      // Configurar event listeners do Socket.IO
      this._setupSocketListeners();
      
      // Obter stream de áudio local
      await this._setupLocalStream();
      
      // Informar que está pronto
      this._emitReady();
      
      this.isInitialized = true;
      this.connectionStatus = 'connected';
      
      console.log(`WebRTC: Inicializado com sucesso para sessão ${sessionId}`);
      return true;
    } catch (error) {
      console.error('WebRTC: Erro ao inicializar:', error);
      this.cleanup();
      return false;
    }
  }
  
  /**
   * Gera um UUID v4 para identificar o participante quando o socket.id não estiver disponível
   * @private
   * @returns {string} UUID único
   */
  _generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, 
            v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  
  /**
   * Registra um participante explicitamente no backend
   * @private
   * @param {string} participantId - ID do participante
   */
  async _registerParticipant(participantId) {
    try {
      console.log(`WebRTC: Registrando participante ${participantId} na sessão ${this.sessionId}`);
      
      const registerUrl = this._buildApiUrl(`webrtc/register-participant/${this.sessionId}/${participantId}`);
      console.log(`WebRTC: Usando URL para registro de participante: ${registerUrl}`);
      
      const config = this._getRequestConfig();
      
      try {
        // Tentar usar a nova API específica para registro
        const response = await axios.post(
          registerUrl,
          {},
          config
        );
        
        if (response.data.success) {
          console.log(`WebRTC: Participante ${participantId} registrado com sucesso no backend via API específica`);
          return true;
        }
      } catch (apiError) {
        console.warn(`WebRTC: API específica de registro não disponível (${apiError.message}), tentando método alternativo...`);
      }
      
      // Método alternativo: criar transport diretamente sem esperar por producers
      // Este método garante que o participante seja registrado no sistema
      console.log(`WebRTC: Usando método alternativo para registro do participante ${participantId}`);
      
      // Inicializar sessão (já foi feito, mas vamos garantir)
      const sessionUrl = this._buildApiUrl(`webrtc/session/${this.sessionId}`);
      await axios.post(sessionUrl, {}, config);
      
      // Iniciar gravação rapidamente e parar em seguida para forçar registro
      const startUrl = this._buildApiUrl(`webrtc/record/start/${this.sessionId}`);
      await axios.post(startUrl, {}, config);
      
      console.log(`WebRTC: Participante ${participantId} provavelmente registrado via método alternativo`);
      return true;
    } catch (error) {
      console.error(`WebRTC: Erro ao registrar participante ${participantId}:`, error);
      // Mesmo com erro, não vamos falhar a inicialização por causa disso
      return false;
    }
  }
  
  /**
   * Inicializa a sessão no backend
   * @private
   */
  async _initializeServerSession() {
    try {
      console.log(`WebRTC: Inicializando sessão no servidor para ${this.sessionId}`);
      const config = this._getRequestConfig();
      console.log('WebRTC: Config de requisição:', config);
      
      const sessionUrl = this._buildApiUrl(`webrtc/session/${this.sessionId}`);
      console.log(`WebRTC: Usando URL para inicializar sessão: ${sessionUrl}`);
      
      const response = await axios.post(
        sessionUrl,
        {},  // Corpo vazio da requisição
        config
      );
      
      if (!response.data.success) {
        throw new Error('Falha ao inicializar sessão no servidor');
      }
      
      console.log('WebRTC: Sessão inicializada no servidor com sucesso');
    } catch (error) {
      console.error('WebRTC: Erro ao inicializar sessão no servidor:', error);
      throw error;
    }
  }
  
  /**
   * Configura os event listeners do Socket.IO
   * @private
   */
  _setupSocketListeners() {
    if (!this.socket) {
      console.error('WebRTC: Socket não disponível');
      return;
    }
    
    console.log('WebRTC: Configurando event listeners do Socket.IO');
    
    // Quando um novo peer está pronto
    this.socket.on('webrtc-peer-ready', (data) => {
      console.log(`WebRTC: Peer pronto: ${data.peerId}`);
      this._createPeerConnection(data.peerId);
    });
    
    // Quando receber uma sinalização WebRTC
    this.socket.on('webrtc-signal', async (data) => {
      try {
        const { type, sourceId } = data;
        console.log(`WebRTC: Sinalização recebida (${type}) de ${sourceId}`);
        
        if (type === 'offer') {
          await this._handleOffer(data);
        } else if (type === 'answer') {
          await this._handleAnswer(data);
        } else if (type === 'ice-candidate') {
          await this._handleIceCandidate(data);
        }
      } catch (error) {
        console.error('WebRTC: Erro ao processar sinalização:', error);
      }
    });
    
    // Quando um usuário entrar na sala
    this.socket.on('user-joined', (data) => {
      console.log(`WebRTC: Usuário entrou na sala: ${data.socketId}`);
      this.participantIds.add(data.socketId);
      this._emitReady();
    });
    
    // Quando receber uma solicitação de transcrição
    this.socket.on('webrtc-transcribe-request', async (data) => {
      console.log(`WebRTC: Solicitação de transcrição recebida de ${data.peerId}${data.forceAudioRequest ? ' com solicitação de áudio' : ''}`);
      
      // Verificar se precisamos garantir que o áudio local está ativo
      if (data.forceAudioRequest) {
        console.log('WebRTC: Processando solicitação explícita de áudio');
        try {
          await this._ensureLocalAudioActive();
          
          // Notificar a UI que o áudio foi ativado
          const event = new CustomEvent('webrtc-audio-activated', {
            detail: { 
              requestedBy: data.peerId,
              timestamp: data.timestamp,
              sessionId: data.sessionId
            }
          });
          window.dispatchEvent(event);
          
          // Destacar o botão de microfone visualmente se possível
          const micButton = document.querySelector('.mic-button, [data-mic="true"], .microphone-button');
          if (micButton) {
            micButton.classList.add('active');
            // Adicionar uma animação de pulso temporária
            micButton.classList.add('pulse-animation');
            setTimeout(() => micButton.classList.remove('pulse-animation'), 2000);
          }
          
          // Destacar que o microfone está ativo com uma classe global
          document.body.classList.add('mic-active');
          
          console.log('WebRTC: Áudio local ativado com sucesso após solicitação');
        } catch (error) {
          console.error('WebRTC: Erro ao garantir áudio local após solicitação:', error);
        }
      }
      
      // Iniciar ou continuar a gravação
      if (this.isRecording) {
        console.log('WebRTC: Já está gravando, verificando se o áudio está ativo');
        // Mesmo se já estiver gravando, garantir que o áudio está ativo
        if (this.localStream && this.localStream.getAudioTracks().length > 0) {
          const audioTrack = this.localStream.getAudioTracks()[0];
          if (!audioTrack.enabled) {
            console.log('WebRTC: Reativando áudio que estava desativado');
            audioTrack.enabled = true;
            this.localAudioEnabled = true;
          }
        }
      } else {
        console.log('WebRTC: Iniciando gravação após solicitação');
        await this.startRecording();
      }
    });
  }
  
  /**
   * Configura o stream local de áudio
   * @private
   */
  async _setupLocalStream() {
    try {
      console.log('WebRTC: Iniciando obtenção de stream de áudio local');
      
      // Verificar se o navegador suporta getUserMedia
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('WebRTC: ERRO - getUserMedia não suportado neste navegador!');
        throw new Error('getUserMedia não suportado neste navegador');
      }
      
      console.log('WebRTC: Verificação de dispositivos de áudio antes de solicitar permissão');
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(device => device.kind === 'audioinput');
        console.log(`WebRTC: Dispositivos de áudio disponíveis: ${audioDevices.length}`);
        
        audioDevices.forEach((device, index) => {
          console.log(`WebRTC: Dispositivo de áudio ${index + 1}: ID=${device.deviceId}, Label=${device.label || 'Sem nome (permissão não concedida)'}`);
        });
        
        if (audioDevices.length === 0) {
          console.warn('WebRTC: ALERTA - Nenhum dispositivo de áudio detectado!');
        }
      } catch (enumError) {
        console.warn('WebRTC: Não foi possível enumerar dispositivos:', enumError);
      }
      
      // Tentar obter o áudio com configurações de alta qualidade para transcrição
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Tentar configurações de áudio de alta qualidade
          sampleRate: 48000,
          sampleSize: 16,
          channelCount: 2
        },
        video: false
      };
      
      console.log('WebRTC: Solicitando permissão de microfone com constraints:', JSON.stringify(constraints));
      
      // Verificar se já temos permissão (para navegadores compatíveis)
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
          console.log(`WebRTC: Status de permissão do microfone: ${permissionStatus.state}`);
          
          permissionStatus.onchange = () => {
            console.log(`WebRTC: Permissão do microfone alterada para: ${permissionStatus.state}`);
          };
        } catch (permError) {
          console.warn('WebRTC: Não foi possível verificar permissão:', permError);
        }
      }
      
      // Solicitar acesso ao microfone
      console.log('WebRTC: Chamando getUserMedia()...');
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('WebRTC: getUserMedia() concluído com sucesso');
      
      // Verificar se realmente obteve permissão de áudio
      const audioTracks = this.localStream.getAudioTracks();
      console.log(`WebRTC: Número de tracks de áudio obtidas: ${audioTracks.length}`);
      
      if (audioTracks.length === 0) {
        console.error('WebRTC: ERRO CRÍTICO - Nenhuma track de áudio encontrada no stream local!');
        this.localAudioEnabled = false;
      } else {
        const track = audioTracks[0];
        console.log(`WebRTC: Track de áudio principal: ID=${track.id}, Label=${track.label}, Enabled=${track.enabled}, Muted=${track.muted}, ReadyState=${track.readyState}`);
        
        // Verificar e ajustar configurações da track
        if (track.getSettings) {
          const settings = track.getSettings();
          console.log('WebRTC: Configurações detalhadas da track de áudio:', JSON.stringify(settings, null, 2));
          
          // Verificar se as configurações são adequadas para transcrição
          if (settings.sampleRate) {
            console.log(`WebRTC: Taxa de amostragem real: ${settings.sampleRate}Hz (ideal: 48000Hz)`);
          }
          if (settings.channelCount) {
            console.log(`WebRTC: Número de canais real: ${settings.channelCount} (ideal: 1-2)`);
          }
        } else {
          console.warn('WebRTC: getSettings() não suportado neste navegador');
        }
        
        // Testar se a track está realmente capturando áudio
        if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
          try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContextClass();
            const source = audioContext.createMediaStreamSource(this.localStream);
            
            // Criar analisador para verificar se há áudio
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            
            // Verificar níveis de áudio
            const checkAudioLevel = () => {
              if (!this.localStream) return; // Parar se o stream foi encerrado
              
              analyser.getByteFrequencyData(dataArray);
              
              // Calcular o nível médio
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }
              const average = sum / dataArray.length;
              
              console.log(`WebRTC: Nível de áudio detectado: ${average.toFixed(2)} (0-255)`);
              
              if (average < 1) {
                console.warn('WebRTC: Nível de áudio muito baixo - possível microfone mudo ou não funcionando');
              } else if (average < 5) {
                console.warn('WebRTC: Nível de áudio baixo - possível ruído de fundo apenas');
              } else {
                console.log('WebRTC: Áudio detectado com sucesso');
              }
            };
            
            // Verificar após 1 segundo (tempo para o usuário falar algo)
            setTimeout(checkAudioLevel, 1000);
          } catch (audioContextError) {
            console.warn('WebRTC: Não foi possível analisar o áudio:', audioContextError);
          }
        }
        
        // Registrar evento para mudanças de estado
        track.onended = () => {
          console.error('WebRTC: ERRO - Track de áudio local terminada inesperadamente');
          this.localAudioEnabled = false;
          
          // Disparar evento para que a UI possa reagir
          const event = new CustomEvent('webrtc-audio-track-ended', {
            detail: { trackId: track.id, timestamp: Date.now() }
          });
          window.dispatchEvent(event);
        };
        
        track.onmute = () => {
          console.warn('WebRTC: Track de áudio silenciada');
          
          // Disparar evento
          const event = new CustomEvent('webrtc-audio-track-muted', {
            detail: { trackId: track.id, timestamp: Date.now() }
          });
          window.dispatchEvent(event);
        };
        
        track.onunmute = () => {
          console.log('WebRTC: Track de áudio reativada');
          
          // Disparar evento
          const event = new CustomEvent('webrtc-audio-track-unmuted', {
            detail: { trackId: track.id, timestamp: Date.now() }
          });
          window.dispatchEvent(event);
        };
        
        // Definir flag que indica que o áudio está habilitado
        this.localAudioEnabled = true;
      }
      
      console.log('WebRTC: Setup de áudio local concluído com sucesso, localAudioEnabled =', this.localAudioEnabled);
      
      // Adicionar o stream em conexões existentes
      if (this.peerConnections.size > 0) {
        console.log(`WebRTC: Adicionando stream local a ${this.peerConnections.size} conexões existentes`);
        
        for (const [peerId, peerConnection] of this.peerConnections.entries()) {
          this._addLocalStreamToPeerConnection(peerConnection, peerId);
        }
      }
      
      // Exibir um elemento de áudio para teste (invisível)
      this._createDebugAudioElement();
      
      return true;
    } catch (error) {
      console.error('WebRTC: ERRO ao obter stream de áudio local:', error);
      console.error('WebRTC: Nome do erro:', error.name);
      console.error('WebRTC: Mensagem do erro:', error.message);
      console.error('WebRTC: Stack trace:', error.stack);
      
      this.localAudioEnabled = false;
      
      // Informar o usuário sobre erros específicos
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        console.error('WebRTC: Permissão de acesso ao microfone NEGADA pelo usuário');
        
        // Disparar evento para que a UI possa mostrar uma mensagem
        const event = new CustomEvent('webrtc-microphone-permission-denied', {
          detail: { errorName: error.name, timestamp: Date.now() }
        });
        window.dispatchEvent(event);
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        console.error('WebRTC: Nenhum dispositivo de áudio encontrado');
        
        // Disparar evento
        const event = new CustomEvent('webrtc-no-audio-device', {
          detail: { errorName: error.name, timestamp: Date.now() }
        });
        window.dispatchEvent(event);
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        console.error('WebRTC: Não foi possível acessar o dispositivo de áudio (em uso por outro aplicativo?)');
        
        // Disparar evento
        const event = new CustomEvent('webrtc-audio-device-busy', {
          detail: { errorName: error.name, timestamp: Date.now() }
        });
        window.dispatchEvent(event);
      }
      
      throw error;
    }
  }
  
  /**
   * Cria um elemento de áudio para debug
   * @private
   */
  _createDebugAudioElement() {
    try {
      // Remover elemento anterior se existir
      const oldAudio = document.getElementById('webrtc-debug-audio');
      if (oldAudio) {
        oldAudio.parentNode.removeChild(oldAudio);
      }
      
      // Criar elemento de áudio para teste
      const audioElement = document.createElement('audio');
      audioElement.id = 'webrtc-debug-audio';
      audioElement.style.display = 'none';
      audioElement.muted = true; // Para evitar feedback
      audioElement.autoplay = true;
      
      // Adicionar à página
      document.body.appendChild(audioElement);
      
      // Conectar o stream
      if (this.localStream) {
        audioElement.srcObject = this.localStream;
        console.log('WebRTC: Elemento de áudio de debug criado e conectado ao stream local');
      }
    } catch (error) {
      console.warn('WebRTC: Não foi possível criar elemento de áudio para debug:', error);
    }
  }
  
  /**
   * Adiciona stream local a uma conexão peer
   * @param {RTCPeerConnection} peerConnection - Conexão peer
   * @param {string} peerId - ID do peer
   * @private 
   */
  _addLocalStreamToPeerConnection(peerConnection, peerId) {
    try {
      console.log(`WebRTC: Iniciando adição de stream local ao peer ${peerId}`);
      
      if (!this.localStream) {
        console.error(`WebRTC: ERRO - Sem stream local para adicionar ao peer ${peerId}`);
        return false;
      }
      
      // Verificar estado da conexão
      console.log(`WebRTC: Estado da conexão com ${peerId}: RTCPeerConnection state=${peerConnection.connectionState}, iceConnectionState=${peerConnection.iceConnectionState}, signalingState=${peerConnection.signalingState}`);
      
      // Verificar quantos senders já existem
      const existingSenders = peerConnection.getSenders();
      console.log(`WebRTC: Conexão com ${peerId} já tem ${existingSenders.length} senders`);
      
      existingSenders.forEach((sender, index) => {
        if (sender.track) {
          console.log(`WebRTC: Sender ${index} existente: trackId=${sender.track.id}, kind=${sender.track.kind}, enabled=${sender.track.enabled}`);
        } else {
          console.log(`WebRTC: Sender ${index} existente sem track associada`);
        }
      });
      
      // Obter tracks de áudio do stream local
      const audioTracks = this.localStream.getAudioTracks();
      console.log(`WebRTC: Stream local tem ${audioTracks.length} tracks de áudio para adicionar ao peer ${peerId}`);
      
      if (audioTracks.length === 0) {
        console.error(`WebRTC: ERRO - Nenhuma track de áudio disponível para adicionar ao peer ${peerId}`);
        return false;
      }
      
      // Adicionar cada track ao peer connection
      let trackCount = 0;
      audioTracks.forEach(track => {
        try {
          console.log(`WebRTC: Adicionando track de áudio ${track.id} (${track.label}) ao peer ${peerId}, enabled=${track.enabled}, readyState=${track.readyState}`);
          
          // Verificar se a track já foi adicionada à conexão
          const existingTrack = existingSenders.find(sender => 
            sender.track && sender.track.id === track.id
          );
          
          if (existingTrack) {
            console.warn(`WebRTC: Track ${track.id} já adicionada anteriormente ao peer ${peerId}`);
            trackCount++;
            return;
          }
          
          const sender = peerConnection.addTrack(track, this.localStream);
          console.log(`WebRTC: Track de áudio ${track.id} adicionada com sucesso ao peer ${peerId}`);
          trackCount++;
          
          // Registrar sender para referência futura se necessário
          if (!peerConnection.localSenders) {
            peerConnection.localSenders = [];
          }
          peerConnection.localSenders.push(sender);
        } catch (trackError) {
          // Pode ocorrer erro se a track já foi adicionada
          console.error(`WebRTC: ERRO ao adicionar track ao peer ${peerId}:`, trackError);
          console.error(`WebRTC: Detalhes do erro: ${trackError.name} - ${trackError.message}`);
          
          // Tentar contornar alguns erros conhecidos
          if (trackError.name === 'InvalidAccessError') {
            console.warn(`WebRTC: A track ${track.id} pode já estar em uso nesta conexão. Tentando alternativa...`);
            
            // Tentar substituir a track em um sender existente
            const audioSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (audioSender) {
              try {
                audioSender.replaceTrack(track);
                console.log(`WebRTC: Track ${track.id} substituída com sucesso usando replaceTrack`);
                trackCount++;
              } catch (replaceError) {
                console.error(`WebRTC: Falha ao substituir track:`, replaceError);
              }
            }
          }
        }
      });
      
      // Verificar se alguma track foi adicionada
      if (trackCount === 0) {
        console.error(`WebRTC: FALHA TOTAL - Nenhuma track de áudio pôde ser adicionada ao peer ${peerId}`);
        return false;
      }
      
      // Verificar novamente os senders após adição
      const updatedSenders = peerConnection.getSenders();
      console.log(`WebRTC: Após adição, peer ${peerId} tem ${updatedSenders.length} senders`);
      
      // Verificar a conexão depois das mudanças
      console.log(`WebRTC: Estado final da conexão com ${peerId}: connectionState=${peerConnection.connectionState}, iceConnectionState=${peerConnection.iceConnectionState}, signalingState=${peerConnection.signalingState}`);
      
      return true;
    } catch (error) {
      console.error(`WebRTC: ERRO CRÍTICO ao adicionar stream local ao peer ${peerId}:`, error);
      console.error(`WebRTC: Stack trace do erro:`, error.stack);
      return false;
    }
  }
  
  /**
   * Informa que está pronto para se conectar
   * @private
   */
  _emitReady() {
    if (!this.socket || !this.sessionId) {
      console.error('WebRTC: Socket ou sessionId não disponível');
      return;
    }
    
    console.log(`WebRTC: Emitindo sinal de pronto para sessão ${this.sessionId}`);
    this.socket.emit('webrtc-ready', { sessionId: this.sessionId });
  }
  
  /**
   * Cria uma conexão peer-to-peer
   * @param {string} peerId - ID do peer
   * @private
   */
  async _createPeerConnection(peerId) {
    try {
      console.log(`WebRTC: -------- INICIANDO CRIAÇÃO DE CONEXÃO COM PEER ${peerId} --------`);
      
      // Verificar se já existe
      if (this.peerConnections.has(peerId)) {
        console.log(`WebRTC: Conexão com peer ${peerId} já existe`);
        
        // Verificar estado da conexão existente
        const existingConnection = this.peerConnections.get(peerId);
        console.log(`WebRTC: Estado da conexão existente: connectionState=${existingConnection.connectionState}, iceConnectionState=${existingConnection.iceConnectionState}, signalingState=${existingConnection.signalingState}`);
        
        // Se a conexão estiver em um estado ruim, podemos fechar e recriar
        if (existingConnection.connectionState === 'failed' || 
            existingConnection.connectionState === 'closed' ||
            existingConnection.iceConnectionState === 'failed' ||
            existingConnection.iceConnectionState === 'disconnected') {
          
          console.log(`WebRTC: A conexão existente com ${peerId} está em mau estado. Fechando para recriar...`);
          
          try {
            existingConnection.close();
          } catch (closeError) {
            console.warn(`WebRTC: Erro ao fechar conexão antiga:`, closeError);
          }
          
          this.peerConnections.delete(peerId);
          console.log(`WebRTC: Conexão antiga com ${peerId} fechada e removida`);
        } else {
          // Se estiver em bom estado, apenas retornar
          return;
        }
      }
      
      console.log(`WebRTC: Criando nova conexão peer-to-peer com ${peerId}`);
      console.log(`WebRTC: Configuração ICE:`, JSON.stringify(this.iceServers));
      
      // Criar conexão
      const peerConnection = new RTCPeerConnection(this.iceServers);
      
      // Armazenar conexão
      this.peerConnections.set(peerId, peerConnection);
      
      // Adicionar streams locais
      if (this.localStream) {
        console.log(`WebRTC: Stream local disponível, adicionando ao peer ${peerId}`);
        const success = this._addLocalStreamToPeerConnection(peerConnection, peerId);
        if (!success) {
          console.error(`WebRTC: FALHA ao adicionar stream local ao peer ${peerId}`);
        }
      } else {
        console.warn(`WebRTC: ALERTA - Criando conexão com ${peerId} sem stream local disponível`);
      }
      
      // Monitorar candidatos ICE
      console.log(`WebRTC: Configurando handler de candidatos ICE para ${peerId}`);
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`WebRTC: Candidato ICE gerado para peer ${peerId}:`, event.candidate.type || 'tipo desconhecido');
          this._sendIceCandidate(peerId, event.candidate);
        } else {
          console.log(`WebRTC: Geração de candidatos ICE finalizada para peer ${peerId}`);
        }
      };
      
      // Monitorar mudanças de estado de conexão
      console.log(`WebRTC: Configurando monitor de estado de conexão para ${peerId}`);
      peerConnection.onconnectionstatechange = () => {
        console.log(`WebRTC: Mudança no connectionState com ${peerId}: ${peerConnection.connectionState}`);
        
        if (peerConnection.connectionState === 'connected') {
          console.log(`WebRTC: SUCESSO - Conexão estabelecida com ${peerId}`);
          
          // Disparar evento para UI
          const event = new CustomEvent('webrtc-peer-connected', {
            detail: { peerId, timestamp: Date.now() }
          });
          window.dispatchEvent(event);
        }
        
        if (peerConnection.connectionState === 'failed') {
          console.error(`WebRTC: ERRO - Conexão com ${peerId} falhou`);
          
          // Disparar evento
          const event = new CustomEvent('webrtc-peer-failed', {
            detail: { peerId, timestamp: Date.now() }
          });
          window.dispatchEvent(event);
        }
        
        if (peerConnection.connectionState === 'disconnected') {
          console.warn(`WebRTC: Conexão com ${peerId} desconectada`);
        }
        
        if (peerConnection.connectionState === 'closed') {
          console.log(`WebRTC: Conexão com ${peerId} foi fechada`);
        }
      };
      
      // Monitorar mudanças de estado ICE
      console.log(`WebRTC: Configurando monitor de estado ICE para ${peerId}`);
      peerConnection.oniceconnectionstatechange = () => {
        console.log(`WebRTC: Estado da conexão ICE com ${peerId}: ${peerConnection.iceConnectionState}`);
        
        // Verificar se a conexão está estabelecida
        if (peerConnection.iceConnectionState === 'connected' || 
            peerConnection.iceConnectionState === 'completed') {
          console.log(`WebRTC: SUCESSO - Conexão ICE estabelecida com ${peerId}`);
          
          // Atualizar estado de conexão global
          this.connectionStatus = 'connected';
          
          // Disparar evento
          const event = new CustomEvent('webrtc-ice-connected', {
            detail: { peerId, timestamp: Date.now() }
          });
          window.dispatchEvent(event);
        }
        
        // Verificar se a conexão foi perdida
        if (peerConnection.iceConnectionState === 'failed') {
          console.error(`WebRTC: ERRO - Conexão ICE com ${peerId} falhou`);
          
          // Disparar evento
          const event = new CustomEvent('webrtc-ice-failed', {
            detail: { peerId, timestamp: Date.now() }
          });
          window.dispatchEvent(event);
          
          // Tentar reiniciar ICE
          try {
            console.log(`WebRTC: Tentando reiniciar ICE para ${peerId}`);
            peerConnection.restartIce();
          } catch (restartError) {
            console.error(`WebRTC: Falha ao reiniciar ICE:`, restartError);
          }
        }
        
        if (peerConnection.iceConnectionState === 'disconnected') {
          console.warn(`WebRTC: ALERTA - Conexão ICE com ${peerId} desconectada`);
        }
        
        if (peerConnection.iceConnectionState === 'closed') {
          console.log(`WebRTC: Conexão ICE com ${peerId} foi fechada`);
          
          // Se fechada, remover do mapa
          this.peerConnections.delete(peerId);
        }
      };
      
      // Monitorar mudanças de estado de sinalização
      console.log(`WebRTC: Configurando monitor de estado de sinalização para ${peerId}`);
      peerConnection.onsignalingstatechange = () => {
        console.log(`WebRTC: Estado de sinalização com ${peerId}: ${peerConnection.signalingState}`);
        
        // Verificar se a negociação está completa
        if (peerConnection.signalingState === 'stable') {
          console.log(`WebRTC: Sinalização estável com ${peerId}`);
        }
        
        // Verificar se a conexão foi fechada
        if (peerConnection.signalingState === 'closed') {
          console.log(`WebRTC: Sinalização fechada com ${peerId}`);
        }
      };
      
      // Monitorar streams remotos
      console.log(`WebRTC: Configurando handler de tracks remotas para ${peerId}`);
      peerConnection.ontrack = (event) => {
        console.log(`WebRTC: Stream remoto recebido de ${peerId}:`, event.streams);
        
        if (!event.streams || event.streams.length === 0) {
          console.warn(`WebRTC: Evento ontrack sem streams para ${peerId}`);
          return;
        }
        
        const stream = event.streams[0];
        console.log(`WebRTC: Detalhes do stream remoto: id=${stream.id}, ativo=${stream.active}`);
        
        // Verificar se é uma track de áudio
        const audioTracks = stream.getAudioTracks();
        console.log(`WebRTC: Stream remoto de ${peerId} tem ${audioTracks.length} tracks de áudio`);
        
        if (audioTracks.length > 0) {
          // Registrar metadados das tracks para ajudar na depuração
          audioTracks.forEach((track, index) => {
            console.log(`WebRTC: Track de áudio ${index} de ${peerId}: id=${track.id}, label=${track.label}, enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
            
            // Adicionar handlers para monitorar mudanças na track
            track.onended = () => {
              console.warn(`WebRTC: Track remota ${track.id} de ${peerId} terminou`);
            };
            
            track.onmute = () => {
              console.log(`WebRTC: Track remota ${track.id} de ${peerId} foi silenciada`);
            };
            
            track.onunmute = () => {
              console.log(`WebRTC: Track remota ${track.id} de ${peerId} foi reativada`);
            };
          });
        } else {
          console.warn(`WebRTC: Stream remoto de ${peerId} não contém tracks de áudio`);
        }
        
        // Armazenar o stream remoto
        this.remoteStreams.set(peerId, stream);
        
        // Emitir evento para notificar que um novo stream foi recebido
        // Isso pode ser usado para atualizar a UI
        const streamEvent = new CustomEvent('webrtc-stream-added', {
          detail: { peerId, stream }
        });
        window.dispatchEvent(streamEvent);
        
        // Criar elemento de áudio para debug do stream remoto
        this._createRemoteDebugAudioElement(stream, peerId);
      };
      
      // Teste adicional para verificar capacidade de estatísticas (ajuda no diagnóstico)
      if (typeof peerConnection.getStats === 'function') {
        console.log(`WebRTC: getStats suportado para peer ${peerId}`);
        
        // Agendar coleta periódica de estatísticas
        const statsInterval = setInterval(async () => {
          if (!this.peerConnections.has(peerId)) {
            clearInterval(statsInterval);
            return;
          }
          
          try {
            const stats = await peerConnection.getStats();
            let audioLevels = false;
            let audioPackets = false;
            
            stats.forEach(stat => {
              // Procurando por estatísticas de áudio
              if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
                audioPackets = true;
                console.log(`WebRTC: Estatísticas de recepção de áudio de ${peerId}: pacotes=${stat.packetsReceived}, perdidos=${stat.packetsLost}, atraso=${stat.jitter?.toFixed(2)}ms`);
              }
              
              if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
                console.log(`WebRTC: Estatísticas de envio de áudio para ${peerId}: pacotes=${stat.packetsSent}, bytes=${stat.bytesSent}`);
              }
              
              // Níveis de áudio
              if (stat.type === 'media-source' && stat.kind === 'audio' && typeof stat.audioLevel !== 'undefined') {
                audioLevels = true;
                console.log(`WebRTC: Nível de áudio local: ${(stat.audioLevel * 100).toFixed(2)}%`);
              }
            });
            
            if (!audioPackets) {
              console.warn(`WebRTC: Nenhum pacote de áudio detectado na conexão com ${peerId}`);
            }
            
            if (!audioLevels) {
              console.warn(`WebRTC: Níveis de áudio não disponíveis na conexão com ${peerId}`);
            }
          } catch (statsError) {
            console.warn(`WebRTC: Erro ao obter estatísticas para ${peerId}:`, statsError);
          }
        }, 10000); // Coletar a cada 10 segundos
      } else {
        console.warn(`WebRTC: getStats não suportado para peer ${peerId}`);
      }
      
      console.log(`WebRTC: Criando oferta para peer ${peerId}`);
      
      // Criar e enviar oferta
      const offerOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
        iceRestart: true // Garantir que iniciamos do zero
      };
      
      console.log(`WebRTC: Opções da oferta:`, offerOptions);
      
      const offer = await peerConnection.createOffer(offerOptions);
      console.log(`WebRTC: Oferta criada para ${peerId}:`, offer.sdp.substring(0, 100) + '...');
      
      console.log(`WebRTC: Definindo descrição local para ${peerId}`);
      await peerConnection.setLocalDescription(offer);
      console.log(`WebRTC: Descrição local definida para ${peerId}`);
      
      this._sendOffer(peerId, offer);
      console.log(`WebRTC: Oferta enviada para ${peerId}`);
      
      console.log(`WebRTC: Conexão peer-to-peer com ${peerId} criada com sucesso`);
      console.log(`WebRTC: -------- FINALIZADA CRIAÇÃO DE CONEXÃO COM PEER ${peerId} --------`);
      
      return true;
    } catch (error) {
      console.error(`WebRTC: ERRO CRÍTICO ao criar conexão peer-to-peer com ${peerId}:`, error);
      console.error(`WebRTC: Detalhes do erro:`, error.message);
      console.error(`WebRTC: Stack trace:`, error.stack);
      
      // Limpar a conexão se existir
      if (this.peerConnections.has(peerId)) {
        try {
          const peerConnection = this.peerConnections.get(peerId);
          peerConnection.close();
        } catch (closeError) {
          console.warn(`WebRTC: Erro ao fechar conexão após falha:`, closeError);
        }
        
        this.peerConnections.delete(peerId);
      }
      
      // Disparar evento de erro
      const event = new CustomEvent('webrtc-peer-connection-error', {
        detail: { 
          peerId, 
          error: { 
            name: error.name, 
            message: error.message 
          },
          timestamp: Date.now()
        }
      });
      window.dispatchEvent(event);
      
      return false;
    }
  }
  
  /**
   * Cria um elemento de áudio de debug para um stream remoto
   * @param {MediaStream} stream - Stream remoto
   * @param {string} peerId - ID do peer
   * @private
   */
  _createRemoteDebugAudioElement(stream, peerId) {
    try {
      const id = `webrtc-debug-remote-audio-${peerId}`;
      
      // Remover elemento anterior se existir
      const oldAudio = document.getElementById(id);
      if (oldAudio) {
        oldAudio.parentNode.removeChild(oldAudio);
      }
      
      // Criar elemento de áudio para teste
      const audioElement = document.createElement('audio');
      audioElement.id = id;
      audioElement.style.display = 'none';
      audioElement.muted = true; // Para evitar feedback
      audioElement.autoplay = true;
      
      // Adicionar à página
      document.body.appendChild(audioElement);
      
      // Conectar o stream
      audioElement.srcObject = stream;
      console.log(`WebRTC: Elemento de áudio de debug criado para stream remoto do peer ${peerId}`);
      
      // Monitorar eventos
      audioElement.onplay = () => console.log(`WebRTC: Áudio remoto de ${peerId} iniciou reprodução`);
      audioElement.onpause = () => console.log(`WebRTC: Áudio remoto de ${peerId} foi pausado`);
      audioElement.onerror = (e) => console.error(`WebRTC: Erro no áudio remoto de ${peerId}:`, e);
    } catch (error) {
      console.warn(`WebRTC: Não foi possível criar elemento de áudio para stream remoto de ${peerId}:`, error);
    }
  }
  
  /**
   * Envia uma oferta para um peer
   * @param {string} peerId - ID do peer
   * @param {RTCSessionDescription} offer - Oferta
   * @private
   */
  _sendOffer(peerId, offer) {
    if (!this.socket || !this.sessionId) {
      console.error('WebRTC: Socket ou sessionId não disponível');
      return;
    }
    
    console.log(`WebRTC: Enviando oferta para ${peerId}`);
    this.socket.emit('webrtc-signal', {
      type: 'offer',
      offer,
      targetId: peerId,
      sessionId: this.sessionId
    });
  }
  
  /**
   * Envia um candidato ICE para um peer
   * @param {string} peerId - ID do peer
   * @param {RTCIceCandidate} candidate - Candidato ICE
   * @private
   */
  _sendIceCandidate(peerId, candidate) {
    if (!this.socket || !this.sessionId) {
      console.error('WebRTC: Socket ou sessionId não disponível');
      return;
    }
    
    console.log(`WebRTC: Enviando candidato ICE para ${peerId}`);
    this.socket.emit('webrtc-signal', {
      type: 'ice-candidate',
      candidate,
      targetId: peerId,
      sessionId: this.sessionId
    });
  }
  
  /**
   * Processa uma oferta recebida
   * @param {Object} data - Dados da oferta
   * @private
   */
  async _handleOffer(data) {
    try {
      const { offer, sourceId } = data;
      
      console.log(`WebRTC: Recebida oferta de ${sourceId}`);
      
      // Criar conexão se não existir
      if (!this.peerConnections.has(sourceId)) {
        console.log(`WebRTC: Criando nova conexão para ${sourceId}`);
        const peerConnection = new RTCPeerConnection(this.iceServers);
        
        // Armazenar conexão
        this.peerConnections.set(sourceId, peerConnection);
        
        // Adicionar streams locais
        if (this.localStream) {
          this._addLocalStreamToPeerConnection(peerConnection, sourceId);
        }
        
        // Monitorar candidatos ICE
        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            this._sendIceCandidate(sourceId, event.candidate);
          }
        };
        
        // Monitorar mudanças de estado
        peerConnection.oniceconnectionstatechange = () => {
          console.log(`WebRTC: Estado da conexão ICE com ${sourceId}: ${peerConnection.iceConnectionState}`);
        };
        
        // Monitorar streams remotos
        peerConnection.ontrack = (event) => {
          console.log(`WebRTC: Stream remoto recebido de ${sourceId}`);
          this.remoteStreams.set(sourceId, event.streams[0]);
        };
      }
      
      const peerConnection = this.peerConnections.get(sourceId);
      
      // Definir descrição remota
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      // Criar resposta
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      // Enviar resposta
      this._sendAnswer(sourceId, answer);
      
      console.log(`WebRTC: Oferta processada e resposta enviada para ${sourceId}`);
    } catch (error) {
      console.error('WebRTC: Erro ao processar oferta:', error);
    }
  }
  
  /**
   * Envia uma resposta para um peer
   * @param {string} peerId - ID do peer
   * @param {RTCSessionDescription} answer - Resposta
   * @private
   */
  _sendAnswer(peerId, answer) {
    if (!this.socket || !this.sessionId) {
      console.error('WebRTC: Socket ou sessionId não disponível');
      return;
    }
    
    console.log(`WebRTC: Enviando resposta para ${peerId}`);
    this.socket.emit('webrtc-signal', {
      type: 'answer',
      answer,
      targetId: peerId,
      sessionId: this.sessionId
    });
  }
  
  /**
   * Processa uma resposta recebida
   * @param {Object} data - Dados da resposta
   * @private
   */
  async _handleAnswer(data) {
    try {
      const { answer, sourceId } = data;
      
      console.log(`WebRTC: Recebida resposta de ${sourceId}`);
      
      if (!this.peerConnections.has(sourceId)) {
        console.error(`WebRTC: Conexão peer ${sourceId} não encontrada`);
        return;
      }
      
      const peerConnection = this.peerConnections.get(sourceId);
      
      // Definir descrição remota
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      
      console.log(`WebRTC: Resposta processada de ${sourceId}`);
    } catch (error) {
      console.error('WebRTC: Erro ao processar resposta:', error);
    }
  }
  
  /**
   * Processa um candidato ICE recebido
   * @param {Object} data - Dados do candidato ICE
   * @private
   */
  async _handleIceCandidate(data) {
    try {
      const { candidate, sourceId } = data;
      
      console.log(`WebRTC: Recebido candidato ICE de ${sourceId}`);
      
      if (!this.peerConnections.has(sourceId)) {
        console.error(`WebRTC: Conexão peer ${sourceId} não encontrada`);
        return;
      }
      
      const peerConnection = this.peerConnections.get(sourceId);
      
      // Adicionar candidato ICE
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      
      console.log(`WebRTC: Candidato ICE processado de ${sourceId}`);
    } catch (error) {
      console.error('WebRTC: Erro ao processar candidato ICE:', error);
    }
  }
  
  /**
   * Inicia a gravação de áudio e garante que todos os participantes recebam a solicitação
   * @returns {Promise<boolean>} - Resultado da operação
   */
  async startRecording() {
    try {
      if (this.isRecording) {
        console.log('WebRTC: Gravação já está ativa');
        return true;
      }
      
      if (!this.sessionId) {
        console.error('WebRTC: sessionId não disponível');
        return false;
      }
      
      console.log(`WebRTC: Iniciando gravação para sessão ${this.sessionId}`);
      
      // Garantir que o stream local de áudio está ativo
      await this._ensureLocalAudioActive();
      
      const startUrl = this._buildApiUrl(`webrtc/record/start/${this.sessionId}`);
      console.log(`WebRTC: Usando URL para iniciar gravação: ${startUrl}`);
      
      // Solicitar início da gravação no servidor
      const config = this._getRequestConfig();
      const response = await axios.post(
        startUrl,
        {},  // Corpo vazio da requisição
        config
      );
      
      if (!response.data.success) {
        throw new Error('Falha ao iniciar gravação no servidor');
      }
      
      // Marcar como gravando
      this.isRecording = true;
      this.recordingStartTime = Date.now();
      
      // Emitir evento para notificar a UI de que a gravação começou
      this._emitRecordingStarted();
      
      // Solicitar que outros peers também iniciem gravação - usar broadcast para todos
      if (this.socket) {
        console.log(`WebRTC: Notificando todos os participantes sobre início da gravação`);
        this.socket.emit('webrtc-transcribe-request', { 
          sessionId: this.sessionId,
          forceAudioRequest: true,
          timestamp: Date.now()
        });
      }
      
      console.log('WebRTC: Gravação iniciada com sucesso');
      return true;
    } catch (error) {
      console.error('WebRTC: Erro ao iniciar gravação:', error);
      return false;
    }
  }
  
  /**
   * Garante que o áudio local está ativo
   * @private
   */
  async _ensureLocalAudioActive() {
    try {
      // Verificar se já temos acesso ao stream de áudio
      if (this.localStream && this.localStream.getAudioTracks().length > 0 && 
          this.localStream.getAudioTracks()[0].enabled) {
        console.log('WebRTC: Áudio local já está ativo');
        return true;
      }
      
      console.log('WebRTC: Solicitando acesso ao microfone...');
      
      // Se não tiver stream local ou estiver com áudio desativado, reativar
      if (!this.localStream) {
        // Solicitar acesso ao microfone
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000
          },
          video: false
        });
        
        this.localStream = stream;
        this.localAudioEnabled = true;
        
        // Adicionar em todas as conexões peer existentes
        for (const [peerId, peerConnection] of this.peerConnections.entries()) {
          this._addLocalStreamToPeerConnection(peerConnection, peerId);
        }
        
        // Emitir evento para atualizar a UI
        const event = new CustomEvent('webrtc-audio-state-changed', {
          detail: { enabled: true }
        });
        window.dispatchEvent(event);
        
        console.log('WebRTC: Acesso ao microfone obtido com sucesso');
      } else if (!this.localStream.getAudioTracks()[0].enabled) {
        // Reativar tracks de áudio
        this.localStream.getAudioTracks().forEach(track => {
          track.enabled = true;
        });
        
        this.localAudioEnabled = true;
        
        // Emitir evento para atualizar a UI
        const event = new CustomEvent('webrtc-audio-state-changed', {
          detail: { enabled: true }
        });
        window.dispatchEvent(event);
        
        console.log('WebRTC: Áudio local reativado');
      }
      
      return true;
    } catch (error) {
      console.error('WebRTC: Erro ao garantir áudio local ativo:', error);
      return false;
    }
  }
  
  /**
   * Emite evento para notificar UI que a gravação começou
   * @private
   */
  _emitRecordingStarted() {
    // Notificar a UI que a gravação começou
    const recordingEvent = new CustomEvent('webrtc-recording-started', {
      detail: {
        sessionId: this.sessionId,
        timestamp: Date.now()
      }
    });
    window.dispatchEvent(recordingEvent);
    
    // Também podemos destacar visualmente na UI
    try {
      // Tentar encontrar elementos de UI relacionados
      const recordButton = document.querySelector('[data-recording="true"], .record-button, .recording-button');
      if (recordButton) {
        recordButton.classList.add('active', 'recording');
      }
      
      // Adicionar uma classe global para indicar gravação ativa
      document.body.classList.add('recording-active');
      
      console.log('WebRTC: UI atualizada para mostrar gravação ativa');
    } catch (e) {
      console.warn('WebRTC: Não foi possível atualizar a UI:', e);
    }
  }
  
  /**
   * Para a gravação de áudio e retorna a transcrição
   * @returns {Promise<Object>} - Resultado da transcrição
   */
  async stopRecording() {
    try {
      if (!this.isRecording) {
        console.log('WebRTC: Nenhuma gravação ativa');
        return null;
      }
      
      if (!this.sessionId) {
        console.error('WebRTC: sessionId não disponível');
        return null;
      }
      
      console.log(`WebRTC: Parando gravação para sessão ${this.sessionId}`);
      
      const stopUrl = this._buildApiUrl(`webrtc/record/stop/${this.sessionId}`);
      console.log(`WebRTC: Usando URL para parar gravação: ${stopUrl}`);
      
      // Solicitar parada da gravação no servidor
      const config = this._getRequestConfig();
      const response = await axios.post(
        stopUrl,
        {},  // Corpo vazio da requisição
        config
      );
      
      if (!response.data.success) {
        throw new Error('Falha ao parar gravação no servidor');
      }
      
      // Marcar como não gravando
      this.isRecording = false;
      const duration = Date.now() - this.recordingStartTime;
      
      console.log(`WebRTC: Gravação finalizada. Duração: ${duration}ms`);
      
      // Processar resultado da transcrição
      const { data } = response.data;
      
      // Chamar callback se disponível
      if (this.transcriptionCallback && data.transcription) {
        this.transcriptionCallback(data.transcription);
      }
      
      return data;
    } catch (error) {
      console.error('WebRTC: Erro ao parar gravação:', error);
      this.isRecording = false;
      return null;
    }
  }
  
  /**
   * Solicita transcrição do áudio atual sem parar a gravação
   * @returns {Promise<Object>} - Resultado da transcrição parcial
   */
  async transcribeCurrentAudio() {
    try {
      if (!this.isRecording) {
        console.log('WebRTC: Nenhuma gravação ativa para transcrição parcial');
        return null;
      }
      
      if (!this.sessionId) {
        console.error('WebRTC: sessionId não disponível');
        return null;
      }
      
      console.log(`WebRTC: Solicitando transcrição parcial para sessão ${this.sessionId}`);
      
      const transcribeUrl = this._buildApiUrl(`webrtc/record/transcribe/${this.sessionId}`);
      console.log(`WebRTC: Usando URL para transcrição parcial: ${transcribeUrl}`);
      
      // Solicitar transcrição parcial no servidor
      const config = this._getRequestConfig();
      const response = await axios.post(
        transcribeUrl,
        {},  // Corpo vazio da requisição
        config
      );
      
      if (!response.data.success) {
        throw new Error('Falha ao solicitar transcrição parcial no servidor');
      }
      
      console.log(`WebRTC: Transcrição parcial concluída com sucesso`);
      
      // Processar resultado da transcrição
      const { data } = response.data;
      
      // Chamar callback se disponível, mas com flag para identificar que é uma transcrição parcial
      if (this.transcriptionCallback && data.transcription) {
        this.transcriptionCallback(data.transcription, {
          isPartial: true,
          timestamp: data.timestamp,
          duration: data.duration
        });
      }
      
      return data;
    } catch (error) {
      console.error('WebRTC: Erro ao solicitar transcrição parcial:', error);
      return null;
    }
  }
  
  /**
   * Retorna o estado atual da conexão WebRTC
   * @returns {Object} - Estado atual
   */
  getStatus() {
    // Contar participantes com áudio real
    let activeAudioCount = 0;
    for (const [peerId, connection] of this.peerConnections.entries()) {
      if (connection.iceConnectionState === 'connected' || 
          connection.iceConnectionState === 'completed') {
        activeAudioCount++;
      }
    }
    
    return {
      isInitialized: this.isInitialized,
      isRecording: this.isRecording,
      connectionStatus: this.connectionStatus,
      participantCount: this.peerConnections.size,
      activeAudioCount,
      localAudioEnabled: this.localAudioEnabled,
      sessionId: this.sessionId
    };
  }
  
  /**
   * Executa diagnóstico de conexões para ajudar a identificar problemas
   * @returns {Object} Relatório de diagnóstico
   */
  diagnoseConnections() {
    const report = {
      overview: {
        initialized: this.isInitialized,
        recording: this.isRecording,
        sessionId: this.sessionId,
        connectionStatus: this.connectionStatus,
        peerCount: this.peerConnections.size,
        localAudio: this.localAudioEnabled
      },
      localAudio: {
        available: !!this.localStream,
        trackCount: this.localStream ? this.localStream.getAudioTracks().length : 0,
        tracks: []
      },
      connections: []
    };
    
    // Coletar informações sobre tracks locais
    if (this.localStream) {
      const audioTracks = this.localStream.getAudioTracks();
      audioTracks.forEach((track, index) => {
        let settings = {};
        if (track.getSettings) {
          settings = track.getSettings();
        }
        
        report.localAudio.tracks.push({
          index,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          settings
        });
      });
    }
    
    // Coletar informações sobre conexões peer
    for (const [peerId, connection] of this.peerConnections.entries()) {
      const connectionInfo = {
        peerId,
        iceConnectionState: connection.iceConnectionState,
        iceGatheringState: connection.iceGatheringState,
        signalingState: connection.signalingState,
        hasRemoteStream: this.remoteStreams.has(peerId),
        remoteTracks: []
      };
      
      // Informações sobre tracks remotas
      const remoteStream = this.remoteStreams.get(peerId);
      if (remoteStream) {
        const audioTracks = remoteStream.getAudioTracks();
        audioTracks.forEach((track, index) => {
          connectionInfo.remoteTracks.push({
            index,
            label: track.label,
            enabled: track.enabled,
            muted: track.muted
          });
        });
      }
      
      report.connections.push(connectionInfo);
    }
    
    console.log('WebRTC: Relatório de diagnóstico gerado:', report);
    return report;
  }
  
  /**
   * Tenta reparar as conexões com problemas
   * @returns {boolean} - true se alguma ação foi tomada
   */
  async repairConnections() {
    let actionsPerformed = false;
    
    // Verificar stream local
    if (!this.localStream || !this.localAudioEnabled) {
      console.log('WebRTC: Tentando reparar stream local de áudio');
      try {
        await this._setupLocalStream();
        actionsPerformed = true;
      } catch (error) {
        console.error('WebRTC: Falha ao reparar stream local:', error);
      }
    }
    
    // Verificar conexões problemáticas
    for (const [peerId, connection] of this.peerConnections.entries()) {
      if (connection.iceConnectionState === 'failed' || 
          connection.iceConnectionState === 'disconnected') {
        console.log(`WebRTC: Tentando reparar conexão com peer ${peerId}`);
        
        // Remover a conexão antiga
        this.peerConnections.delete(peerId);
        
        // Criar nova conexão
        try {
          await this._createPeerConnection(peerId);
          actionsPerformed = true;
        } catch (error) {
          console.error(`WebRTC: Falha ao recriar conexão para peer ${peerId}:`, error);
        }
      }
    }
    
    return actionsPerformed;
  }
  
  /**
   * Limpa recursos e encerra conexões
   */
  cleanup() {
    try {
      console.log('WebRTC: Limpando recursos');
      
      // Parar gravação se ativa
      if (this.isRecording) {
        this.stopRecording().catch(err => console.error('WebRTC: Erro ao parar gravação durante cleanup:', err));
      }
      
      // Fechar todas as conexões peer
      for (const [peerId, connection] of this.peerConnections.entries()) {
        console.log(`WebRTC: Fechando conexão com peer ${peerId}`);
        connection.close();
      }
      
      // Limpar streams
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
      }
      
      // Limpar coleções
      this.peerConnections.clear();
      this.remoteStreams.clear();
      this.participantIds.clear();
      
      // Resetar estado
      this.localStream = null;
      this.isRecording = false;
      this.isInitialized = false;
      this.connectionStatus = 'disconnected';
      
      console.log('WebRTC: Recursos limpos com sucesso');
    } catch (error) {
      console.error('WebRTC: Erro ao limpar recursos:', error);
    }
  }
}

// Singleton instance
const webrtcTranscriptionService = new WebRTCTranscriptionService();

export default webrtcTranscriptionService; 