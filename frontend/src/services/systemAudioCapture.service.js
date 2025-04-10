/**
 * Serviço para captura combinada de áudio do sistema e microfone
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
  
  async startCapture() {
    try {
      console.log('Iniciando captura combinada de áudio...');
      
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const destination = this.audioContext.createMediaStreamDestination();
      
      try {
        this.microphoneStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        
        const micSource = this.audioContext.createMediaStreamSource(this.microphoneStream);
        micSource.connect(destination);
        console.log('Microfone conectado ao contexto de áudio');
      } catch (micError) {
        console.warn('Não foi possível acessar o microfone:', micError);
        alert('Para gravar sua voz junto com o áudio do sistema, permita o acesso ao microfone.');
        return false;
      }
      
      try {
        this.systemStream = await navigator.mediaDevices.getDisplayMedia({
          video: false,
          audio: true
        });
        
        const audioTracks = this.systemStream.getAudioTracks();
        if (audioTracks.length === 0) {
          console.error('Nenhuma faixa de áudio disponível na captura do sistema');
          alert('Por favor, selecione "Compartilhar áudio" quando solicitado para capturar o áudio da chamada.');
          
          this.microphoneStream.getTracks().forEach(track => track.stop());
          this.audioContext.close();
          return false;
        }
        
        const systemSource = this.audioContext.createMediaStreamSource(this.systemStream);
        systemSource.connect(destination);
        console.log('Áudio do sistema conectado ao contexto de áudio');
      } catch (systemError) {
        console.warn('Não foi possível acessar o áudio do sistema:', systemError);
        
        this.microphoneStream.getTracks().forEach(track => track.stop());
        this.audioContext.close();
        return false;
      }
      
      this.combinedStream = destination.stream;
      
      const options = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        options.mimeType = 'audio/ogg;codecs=opus';
      }
      
      this.mediaRecorder = new MediaRecorder(this.combinedStream, options);
      this.chunks = [];
      
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };
      
      this.mediaRecorder.start(1000);
      this.isRecording = true;
      
      console.log('Captura combinada de áudio iniciada com sucesso');
      return true;
    } catch (error) {
      console.error('Erro ao iniciar captura combinada de áudio:', error);
      
      this._cleanupResources();
      return false;
    }
  }
  
  stopCapture() {
    return new Promise((resolve) => {
      if (!this.isRecording || !this.mediaRecorder) {
        console.warn('Nenhuma gravação em andamento para parar');
        resolve(null);
        return;
      }
      
      console.log('Parando captura de áudio...');
      
      this.mediaRecorder.onstop = () => {
        console.log('Criando blob de áudio com chunks');
        
        const blob = new Blob(this.chunks, { 
          type: this.mediaRecorder.mimeType || 'audio/webm' 
        });
        
        this._cleanupResources();
        
        console.log('Captura de áudio finalizada');
        resolve(blob);
      };
      
      this.mediaRecorder.stop();
    });
  }
  
  _cleanupResources() {
    if (this.systemStream) {
      this.systemStream.getTracks().forEach(track => track.stop());
      this.systemStream = null;
    }
    
    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach(track => track.stop());
      this.microphoneStream = null;
    }
    
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (e) {
        console.warn('Erro ao fechar contexto de áudio:', e);
      }
      this.audioContext = null;
    }
    
    this.combinedStream = null;
    this.chunks = [];
    this.isRecording = false;
    this.mediaRecorder = null;
  }
}

const systemAudioCaptureService = new SystemAudioCaptureService();
export default systemAudioCaptureService;