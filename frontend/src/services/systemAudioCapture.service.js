/**
 * Serviço para captura combinada de áudio do sistema e microfone
 * Usamos getDisplayMedia para áudio do sistema e getUserMedia para microfone
 */
class SystemAudioCaptureService {
  constructor() {
    this.mediaRecorder = null;
    this.systemStream = null;
    this.microphoneStream = null;
    this.combinedStream = null;
    this.audioContext = null;
    this.chunks = [];
    this.isRecording = false;
  }
  
  /**
   * Inicia a captura de áudio do sistema e microfone combinados
   * @returns {Promise<boolean>} Sucesso da operação
   */
  async startCapture() {
    try {
      console.log('Iniciando captura combinada de áudio...');
      
      // 1. Criar contexto de áudio para combinar os streams
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const destination = this.audioContext.createMediaStreamDestination();
      
      // 2. Solicitar permissão para microfone
      console.log('Solicitando permissão para microfone...');
      try {
        this.microphoneStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        
        // Conectar microfone ao destino
        const micSource = this.audioContext.createMediaStreamSource(this.microphoneStream);
        micSource.connect(destination);
        console.log('Microfone conectado ao contexto de áudio');
      } catch (micError) {
        console.warn('Não foi possível acessar o microfone:', micError);
        alert('Para gravar sua voz junto com o áudio do sistema, permita o acesso ao microfone.');
        return false;
      }
      
      // 3. Solicitar permissão para áudio do sistema
      console.log('Solicitando permissão para capturar áudio do sistema...');
      try {
        this.systemStream = await navigator.mediaDevices.getDisplayMedia({
          video: false,
          audio: true
        });
        
        // Verificar se temos faixas de áudio no systemStream
        const audioTracks = this.systemStream.getAudioTracks();
        if (audioTracks.length === 0) {
          console.error('Nenhuma faixa de áudio disponível na captura do sistema');
          alert('Por favor, selecione "Compartilhar áudio" quando solicitado para capturar o áudio da chamada.');
          
          // Limpar recursos antes de sair
          this.microphoneStream.getTracks().forEach(track => track.stop());
          this.audioContext.close();
          return false;
        }
        
        // Conectar audio do sistema ao destino
        const systemSource = this.audioContext.createMediaStreamSource(this.systemStream);
        systemSource.connect(destination);
        console.log('Áudio do sistema conectado ao contexto de áudio');
      } catch (systemError) {
        console.warn('Não foi possível acessar o áudio do sistema:', systemError);
        
        // Limpar recursos antes de sair
        this.microphoneStream.getTracks().forEach(track => track.stop());
        this.audioContext.close();
        return false;
      }
      
      // 4. Obter o stream combinado
      this.combinedStream = destination.stream;
      
      // 5. Configurar o MediaRecorder
      const options = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        options.mimeType = 'audio/ogg;codecs=opus';
      }
      
      this.mediaRecorder = new MediaRecorder(this.combinedStream, options);
      this.chunks = [];
      
      // 6. Configurar eventos
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };
      
      // 7. Iniciar gravação
      this.mediaRecorder.start(1000);
      this.isRecording = true;
      
      console.log('Captura combinada de áudio iniciada com sucesso');
      return true;
    } catch (error) {
      console.error('Erro ao iniciar captura combinada de áudio:', error);
      
      // Limpar qualquer recurso
      this._cleanupResources();
      return false;
    }
  }
  
  /**
   * Para a captura de áudio e retorna o blob
   * @returns {Promise<Blob|null>} Blob com o áudio capturado ou null em caso de erro
   */
  stopCapture() {
    return new Promise((resolve) => {
      if (!this.isRecording || !this.mediaRecorder) {
        console.warn('Nenhuma gravação em andamento para parar');
        resolve(null);
        return;
      }
      
      console.log('Parando captura de áudio...');
      
      // Handler para quando a gravação parar
      this.mediaRecorder.onstop = () => {
        console.log(`Criando blob de áudio com ${this.chunks.length} chunks`);
        
        // Criar blob com todos os chunks
        const blob = new Blob(this.chunks, { 
          type: this.mediaRecorder.mimeType || 'audio/webm' 
        });
        
        // Limpar recursos
        this._cleanupResources();
        
        console.log(`Captura de áudio finalizada. Tamanho: ${Math.round(blob.size / 1024)}KB`);
        resolve(blob);
      };
      
      // Parar a gravação (isso vai disparar o evento onstop)
      this.mediaRecorder.stop();
    });
  }
  
  /**
   * Limpa todos os recursos de mídia
   * @private
   */
  _cleanupResources() {
    // Parar todas as faixas do stream do sistema
    if (this.systemStream) {
      this.systemStream.getTracks().forEach(track => track.stop());
      this.systemStream = null;
    }
    
    // Parar todas as faixas do stream do microfone
    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach(track => track.stop());
      this.microphoneStream = null;
    }
    
    // Fechar contexto de áudio
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (e) {
        console.warn('Erro ao fechar contexto de áudio:', e);
      }
      this.audioContext = null;
    }
    
    // Limpar outros recursos
    this.combinedStream = null;
    this.chunks = [];
    this.isRecording = false;
    this.mediaRecorder = null;
  }
}

// Exportar como singleton
const systemAudioCaptureService = new SystemAudioCaptureService();
export default systemAudioCaptureService; 