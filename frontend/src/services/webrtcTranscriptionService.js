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
    
    // Configuração ICE para WebRTC
    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };
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
   * Inicializa a sessão no backend
   * @private
   */
  async _initializeServerSession() {
    try {
      console.log(`WebRTC: Inicializando sessão no servidor para ${this.sessionId}`);
      const config = this._getRequestConfig();
      console.log('WebRTC: Config de requisição:', config);
      
      const response = await axios.post(
        `${API_URL}/webrtc/session/${this.sessionId}`,
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
    this.socket.on('webrtc-transcribe-request', (data) => {
      console.log(`WebRTC: Solicitação de transcrição recebida de ${data.peerId}`);
      if (this.isRecording) {
        console.log('WebRTC: Já está gravando, ignorando...');
      } else {
        this.startRecording();
      }
    });
  }
  
  /**
   * Configura o stream local de áudio
   * @private
   */
  async _setupLocalStream() {
    try {
      console.log('WebRTC: Obtendo stream de áudio local');
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      
      console.log('WebRTC: Stream de áudio local obtido com sucesso');
    } catch (error) {
      console.error('WebRTC: Erro ao obter stream de áudio local:', error);
      throw error;
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
      // Verificar se já existe
      if (this.peerConnections.has(peerId)) {
        console.log(`WebRTC: Conexão com peer ${peerId} já existe`);
        return;
      }
      
      console.log(`WebRTC: Criando conexão peer-to-peer com ${peerId}`);
      
      // Criar conexão
      const peerConnection = new RTCPeerConnection(this.iceServers);
      
      // Armazenar conexão
      this.peerConnections.set(peerId, peerConnection);
      
      // Adicionar streams locais
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, this.localStream);
        });
      }
      
      // Monitorar candidatos ICE
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this._sendIceCandidate(peerId, event.candidate);
        }
      };
      
      // Monitorar mudanças de estado
      peerConnection.oniceconnectionstatechange = () => {
        console.log(`WebRTC: Estado da conexão ICE com ${peerId}: ${peerConnection.iceConnectionState}`);
      };
      
      // Monitorar streams remotos
      peerConnection.ontrack = (event) => {
        console.log(`WebRTC: Stream remoto recebido de ${peerId}`);
        this.remoteStreams.set(peerId, event.streams[0]);
      };
      
      // Criar e enviar oferta
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      
      await peerConnection.setLocalDescription(offer);
      
      this._sendOffer(peerId, offer);
      
      console.log(`WebRTC: Conexão peer-to-peer com ${peerId} criada com sucesso`);
    } catch (error) {
      console.error(`WebRTC: Erro ao criar conexão peer-to-peer com ${peerId}:`, error);
      this.peerConnections.delete(peerId);
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
          this.localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, this.localStream);
          });
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
   * Inicia a gravação de áudio
   * @returns {Promise<boolean>} - Sucesso ou falha
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
      
      // Solicitar início da gravação no servidor
      const config = this._getRequestConfig();
      const response = await axios.post(
        `${API_URL}/webrtc/record/start/${this.sessionId}`,
        {},  // Corpo vazio da requisição
        config
      );
      
      if (!response.data.success) {
        throw new Error('Falha ao iniciar gravação no servidor');
      }
      
      // Marcar como gravando
      this.isRecording = true;
      this.recordingStartTime = Date.now();
      
      // Solicitar que outros peers também iniciem gravação
      if (this.socket) {
        this.socket.emit('webrtc-transcribe-request', { sessionId: this.sessionId });
      }
      
      console.log('WebRTC: Gravação iniciada com sucesso');
      return true;
    } catch (error) {
      console.error('WebRTC: Erro ao iniciar gravação:', error);
      return false;
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
      
      // Solicitar parada da gravação no servidor
      const config = this._getRequestConfig();
      const response = await axios.post(
        `${API_URL}/webrtc/record/stop/${this.sessionId}`,
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
      
      // Solicitar transcrição parcial no servidor
      const config = this._getRequestConfig();
      const response = await axios.post(
        `${API_URL}/webrtc/record/transcribe/${this.sessionId}`,
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
    return {
      isInitialized: this.isInitialized,
      isRecording: this.isRecording,
      connectionStatus: this.connectionStatus,
      participantCount: this.peerConnections.size,
      sessionId: this.sessionId
    };
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