const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../../utils/logger');
const logger = createLogger('transcription-service');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const FormData = require('form-data');
const openaiService = require('./openai.service');

// Configurar ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

class TranscriptionService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Converte um vídeo para áudio em MP3
   * @param {string} videoPath - Caminho do arquivo de vídeo
   * @returns {Promise<string>} - Caminho do arquivo de áudio gerado
   */
  async extractAudioFromVideo(videoPath) {
    const audioPath = videoPath.replace(/\.[^/.]+$/, '.mp3');
    
    return new Promise((resolve, reject) => {
      logger.info(`Extraindo áudio de: ${videoPath}`);
      
      ffmpeg(videoPath)
        .output(audioPath)
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .on('end', () => {
          logger.info(`Extração de áudio concluída: ${audioPath}`);
          resolve(audioPath);
        })
        .on('error', (err) => {
          logger.error(`Erro ao extrair áudio: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }

  /**
   * Divide arquivo de áudio em partes menores (máx. 25MB)
   * @param {string} audioPath - Caminho do arquivo de áudio
   * @returns {Promise<string[]>} - Lista de caminhos dos arquivos divididos
   */
  async splitAudioIfNeeded(audioPath) {
    const stat = fs.statSync(audioPath);
    const fileSizeInBytes = stat.size;
    const maxSizeInBytes = 25 * 1024 * 1024; // 25MB (limite da API Whisper)
    
    // Se o arquivo for menor que o limite, retornar como está
    if (fileSizeInBytes <= maxSizeInBytes) {
      return [audioPath];
    }
    
    // Obter duração do áudio
    const getDuration = () => {
      return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(metadata.format.duration);
        });
      });
    };
    
    const duration = await getDuration();
    const segments = Math.ceil(fileSizeInBytes / maxSizeInBytes);
    const segmentDuration = Math.floor(duration / segments);
    
    logger.info(`Arquivo de áudio de ${fileSizeInBytes / (1024 * 1024)}MB será dividido em ${segments} partes de ${segmentDuration}s cada`);
    
    const segmentPaths = [];
    
    for (let i = 0; i < segments; i++) {
      const segmentPath = audioPath.replace(/\.mp3$/, `_parte${i+1}.mp3`);
      const startTime = i * segmentDuration;
      
      await new Promise((resolve, reject) => {
        ffmpeg(audioPath)
          .setStartTime(startTime)
          .setDuration(segmentDuration)
          .output(segmentPath)
          .audioCodec('libmp3lame')
          .audioBitrate('128k')
          .on('end', () => {
            logger.info(`Parte ${i+1}/${segments} gerada: ${segmentPath}`);
            segmentPaths.push(segmentPath);
            resolve();
          })
          .on('error', (err) => {
            logger.error(`Erro ao dividir áudio (parte ${i+1}): ${err.message}`);
            reject(err);
          })
          .run();
      });
    }
    
    return segmentPaths;
  }

  /**
   * Transcreve um arquivo de áudio usando a API Whisper da OpenAI
   * @param {string} audioPath - Caminho do arquivo de áudio
   * @param {Object} options - Opções de transcrição (idioma, etc)
   * @returns {Promise<string>} - Texto transcrito
   */
  async transcribeAudio(audioPath, options = {}) {
    try {
      logger.info(`Iniciando transcrição do áudio: ${audioPath}`);
      
      const audioFile = fs.createReadStream(audioPath);
      
      const transcription = await this.openai.audio.transcriptions.create({
        file: audioFile,
        model: "whisper-1",
        language: options.language || "pt",
        response_format: "text"
      });
      
      logger.info(`Transcrição concluída para: ${audioPath}`);
      return transcription;
    } catch (error) {
      logger.error(`Erro ao transcrever áudio: ${error.message}`);
      throw error;
    }
  }

  /**
   * Processa um arquivo de vídeo/áudio completo e retorna a transcrição
   * @param {string} filePath - Caminho do arquivo a ser transcrito
   * @param {Object} options - Opções de transcrição
   * @returns {Promise<string>} - Texto transcrito completo
   */
  async processFile(filePath, options = {}) {
    try {
      logger.info(`Iniciando processamento de arquivo para transcrição: ${filePath}`);
      
      // Verificar se é um arquivo de vídeo que precisa de extração de áudio
      const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv'];
      const fileExt = path.extname(filePath).toLowerCase();
      
      // Se for vídeo, extrair o áudio primeiro
      let audioPath = filePath;
      if (videoExtensions.includes(fileExt)) {
        logger.info(`Arquivo é um vídeo. Extraindo áudio...`);
        audioPath = await this.extractAudioFromVideo(filePath);
      }
      
      // Dividir o áudio se necessário (para arquivos grandes)
      const audioParts = await this.splitAudioIfNeeded(audioPath);
      
      // Transcrever cada parte
      const transcriptions = [];
      for (let i = 0; i < audioParts.length; i++) {
        logger.info(`Transcrevendo parte ${i+1}/${audioParts.length}`);
        const partTranscription = await this.transcribeAudio(audioParts[i], options);
        transcriptions.push(partTranscription);
        
        // Remover arquivo temporário de parte se for diferente do original
        if (audioParts.length > 1 && audioParts[i] !== filePath) {
          fs.unlinkSync(audioParts[i]);
          logger.info(`Arquivo temporário removido: ${audioParts[i]}`);
        }
      }
      
      // Remover arquivo de áudio temporário se foi extraído de vídeo
      if (audioPath !== filePath) {
        fs.unlinkSync(audioPath);
        logger.info(`Arquivo de áudio temporário removido: ${audioPath}`);
      }
      
      // Juntar todas as transcrições em um único texto
      const fullTranscription = transcriptions.join('\n\n');
      logger.info(`Transcrição completa concluída. Tamanho: ${fullTranscription.length} caracteres`);
      
      return fullTranscription;
    } catch (error) {
      logger.error(`Erro durante o processo de transcrição: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new TranscriptionService(); 