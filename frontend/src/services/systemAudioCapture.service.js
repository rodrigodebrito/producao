/**
 * Serviço para captura de áudio do sistema (som de saída)
 * Usamos getDisplayMedia para capturar o áudio que está sendo reproduzido pelo sistema
 */
class SystemAudioCaptureService {
  constructor() {
    this.mediaRecorder = null;
    this.stream = null;
    this.chunks = [];
    this.isRecording = false;
  }
  
  /**
   * Inicia a captura de áudio do sistema
   * @returns {Promise<boolean>} Sucesso da operação
   */
  async startCapture() {
    try {
      console.log('Solicitando permissão para capturar áudio do sistema...');
      
      // Solicitar compartilhamento de tela com áudio do sistema
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: false,
        audio: true
      });
      
      console.log('Permissão concedida para captura de áudio do sistema');
      
      // Verificar se temos áudio
      const audioTracks = this.stream.getAudioTracks();
      if (audioTracks.length === 0) {
        console.error('Nenhuma faixa de áudio disponível na captura');
        this.stopCapture();
        return false;
      }
      
      console.log(`Faixas de áudio disponíveis: ${audioTracks.length}`);
      
      // Configurar o MediaRecorder
      const options = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        options.mimeType = 'audio/ogg;codecs=opus';
      }
      
      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.chunks = [];
      
      // Configurar eventos
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };
      
      // Iniciar gravação
      this.mediaRecorder.start(1000);
      this.isRecording = true;
      
      console.log('Captura de áudio do sistema iniciada com sucesso');
      return true;
    } catch (error) {
      console.error('Erro ao iniciar captura de áudio do sistema:', error);
      // Limpar qualquer recurso
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
      return false;
    }
  }
  
  /**
   * Para a captura de áudio do sistema e retorna o blob
   * @returns {Promise<Blob|null>} Blob com o áudio capturado ou null em caso de erro
   */
  stopCapture() {
    return new Promise((resolve) => {
      if (!this.isRecording || !this.mediaRecorder) {
        console.warn('Nenhuma gravação em andamento para parar');
        resolve(null);
        return;
      }
      
      console.log('Parando captura de áudio do sistema...');
      
      // Handler para quando a gravação parar
      this.mediaRecorder.onstop = () => {
        console.log(`Criando blob de áudio com ${this.chunks.length} chunks`);
        
        // Criar blob com todos os chunks
        const blob = new Blob(this.chunks, { 
          type: this.mediaRecorder.mimeType || 'audio/webm' 
        });
        
        // Limpar recursos
        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop());
        }
        
        this.stream = null;
        this.chunks = [];
        this.isRecording = false;
        this.mediaRecorder = null;
        
        console.log(`Captura de áudio finalizada. Tamanho: ${Math.round(blob.size / 1024)}KB`);
        resolve(blob);
      };
      
      // Parar a gravação (isso vai disparar o evento onstop)
      this.mediaRecorder.stop();
    });
  }
}

// Exportar como singleton
const systemAudioCaptureService = new SystemAudioCaptureService();
export default systemAudioCaptureService; 