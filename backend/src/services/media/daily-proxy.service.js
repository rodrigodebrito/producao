const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const ffmpeg = require('fluent-ffmpeg');
const logger = require('../../config/logger');
const { AUDIO_DIR } = require('../../config/constants');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const whisperService = require('./whisper.service');
const audioService = require('./audio.service');

// Transformar métodos callback em promise
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const access = promisify(fs.access);

// Armazenar sessões em memória
const activeSessions = new Map();

/**
 * Garante que o diretório de áudio existe
 * @param {string} sessionId - ID da sessão
 * @returns {Promise<string>} - Caminho do diretório de áudio
 */
async function ensureAudioDir(sessionId) {
  const sessionDir = path.join(AUDIO_DIR, sessionId);
  
  try {
    await access(sessionDir, fs.constants.F_OK);
  } catch (err) {
    await mkdir(sessionDir, { recursive: true });
  }
  
  return sessionDir;
}

/**
 * Classe que gerencia a captura de áudio de uma sala Daily.co
 */
class DailyAudioCapture {
  constructor(sessionId, roomUrl) {
    this.sessionId = sessionId;
    this.roomUrl = roomUrl;
    this.startTime = Date.now();
    this.isActive = true;
    this.participants = new Map();
    this.audioChunks = new Map();
    this.outputDir = path.join(process.cwd(), 'audio_files', sessionId);
    
    // Criar diretório para os arquivos de áudio se não existir
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Adiciona um novo participante à sessão
   * @param {string} participantId - ID do participante
   * @returns {Object} - Informações do participante
   */
  addParticipant(participantId) {
    if (!this.participants.has(participantId)) {
      const participant = {
        id: participantId,
        joinTime: Date.now(),
        audioFile: path.join(this.outputDir, `${participantId}.wav`),
        chunks: []
      };
      
      this.participants.set(participantId, participant);
      this.audioChunks.set(participantId, []);
      return participant;
    }
    
    return this.participants.get(participantId);
  }

  /**
   * Processa um chunk de áudio de um participante
   * @param {string} participantId - ID do participante
   * @param {Buffer} audioData - Dados de áudio a serem processados
   * @returns {boolean} - Sucesso da operação
   */
  async processAudioChunk(participantId, audioData) {
    if (!this.isActive) {
      logger.warn(`Tentativa de processar áudio para sessão inativa: ${this.sessionId}`);
      return false;
    }

    // Adicionar participante se ainda não existir
    if (!this.participants.has(participantId)) {
      this.addParticipant(participantId);
    }

    const chunks = this.audioChunks.get(participantId);
    chunks.push(audioData);

    // Processar chunks em batch quando acumular um número suficiente
    if (chunks.length >= 10) {
      try {
        const participant = this.participants.get(participantId);
        const combinedData = Buffer.concat(chunks);
        
        // Salvar o áudio em um arquivo temporário
        const tempFilePath = path.join(this.outputDir, `${participantId}_temp_${Date.now()}.wav`);
        fs.writeFileSync(tempFilePath, combinedData);
        
        // Processar o áudio (ex: concatenar com arquivo existente)
        await audioService.appendToFile(tempFilePath, participant.audioFile);
        
        // Limpar chunks processados
        this.audioChunks.set(participantId, []);
        
        // Remover arquivo temporário
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (error) {
        logger.error(`Erro ao processar chunks de áudio: ${error.message}`, {
          error,
          sessionId: this.sessionId,
          participantId
        });
      }
    }

    return true;
  }

  /**
   * Finaliza a captura de áudio e processa os arquivos
   * @returns {Object} - Resultado do processamento
   */
  async stop() {
    if (!this.isActive) {
      return null;
    }

    this.isActive = false;
    const endTime = Date.now();
    const duration = (endTime - this.startTime) / 1000; // em segundos

    // Processar quaisquer chunks de áudio restantes
    for (const [participantId, chunks] of this.audioChunks.entries()) {
      if (chunks.length > 0) {
        try {
          const participant = this.participants.get(participantId);
          const combinedData = Buffer.concat(chunks);
          
          // Salvar o áudio em um arquivo temporário
          const tempFilePath = path.join(this.outputDir, `${participantId}_temp_final.wav`);
          fs.writeFileSync(tempFilePath, combinedData);
          
          // Processar o áudio (ex: concatenar com arquivo existente)
          await audioService.appendToFile(tempFilePath, participant.audioFile);
          
          // Remover arquivo temporário
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (error) {
          logger.error(`Erro ao processar chunks finais de áudio: ${error.message}`, {
            error,
            sessionId: this.sessionId,
            participantId
          });
        }
      }
    }

    // Combinar áudios de todos os participantes
    const participantFiles = Array.from(this.participants.values()).map(p => p.audioFile);
    const combinedAudioFile = path.join(this.outputDir, `combined_${this.sessionId}.wav`);
    
    try {
      // Verificar se existem arquivos para combinar
      const validFiles = participantFiles.filter(file => fs.existsSync(file) && fs.statSync(file).size > 0);
      
      if (validFiles.length > 0) {
        await audioService.combineAudioFiles(validFiles, combinedAudioFile);
      } else {
        logger.warn(`Nenhum arquivo de áudio válido para combinar na sessão ${this.sessionId}`);
      }
    } catch (error) {
      logger.error(`Erro ao combinar arquivos de áudio: ${error.message}`, {
        error,
        sessionId: this.sessionId
      });
    }

    // Retornar informações sobre o resultado
    return {
      sessionId: this.sessionId,
      duration,
      participants: Array.from(this.participants.values()).map(p => ({
        id: p.id,
        joinTime: p.joinTime,
        audioFile: p.audioFile,
        hasAudio: fs.existsSync(p.audioFile) && fs.statSync(p.audioFile).size > 0
      })),
      combinedAudioFile: fs.existsSync(combinedAudioFile) ? combinedAudioFile : null
    };
  }

  /**
   * Obtém o status atual da captura
   * @returns {Object} - Informações sobre o status da captura
   */
  getStatus() {
    return {
      sessionId: this.sessionId,
      roomUrl: this.roomUrl,
      startTime: this.startTime,
      isActive: this.isActive,
      duration: (Date.now() - this.startTime) / 1000, // em segundos
      participants: Array.from(this.participants.values()).map(p => ({
        id: p.id,
        joinTime: p.joinTime,
        hasAudio: fs.existsSync(p.audioFile) && fs.statSync(p.audioFile).size > 0
      }))
    };
  }
}

/**
 * Inicia a captura de áudio para uma sessão
 * @param {string} sessionId - ID da sessão
 * @param {string} roomUrl - URL da sala Daily.co
 * @returns {Object} - Informações sobre a captura iniciada
 */
exports.startCapture = async (sessionId, roomUrl) => {
  // Verificar se já existe uma captura ativa para esta sessão
  if (activeSessions.has(sessionId)) {
    // Se existir, parar a captura anterior
    const existingCapture = activeSessions.get(sessionId);
    if (existingCapture.isActive) {
      await existingCapture.stop();
    }
  }

  // Criar nova instância de captura
  const capture = new DailyAudioCapture(sessionId, roomUrl);
  activeSessions.set(sessionId, capture);

  return capture.getStatus();
};

/**
 * Obtém o status de uma captura de áudio
 * @param {string} sessionId - ID da sessão
 * @returns {Object|null} - Status da captura ou null se não encontrada
 */
exports.getCaptureStatus = async (sessionId) => {
  const capture = activeSessions.get(sessionId);
  if (!capture) {
    return null;
  }

  return capture.getStatus();
};

/**
 * Interrompe a captura de áudio para uma sessão
 * @param {string} sessionId - ID da sessão
 * @returns {Object|null} - Resultado da captura ou null se não encontrada
 */
exports.stopCapture = async (sessionId) => {
  const capture = activeSessions.get(sessionId);
  if (!capture) {
    return null;
  }

  const result = await capture.stop();
  
  // Manter a sessão no mapa por um tempo para consultas posteriores
  setTimeout(() => {
    activeSessions.delete(sessionId);
  }, 3600000); // Remover após 1 hora
  
  return result;
};

/**
 * Processa um chunk de áudio recebido do cliente
 * @param {string} sessionId - ID da sessão
 * @param {string} participantId - ID do participante (opcional)
 * @param {Buffer} audioData - Dados de áudio a serem processados
 * @returns {boolean} - Sucesso da operação
 */
exports.processAudioChunk = async (sessionId, participantId, audioData) => {
  const capture = activeSessions.get(sessionId);
  if (!capture || !capture.isActive) {
    return false;
  }

  const actualParticipantId = participantId || `anonymous_${uuidv4().substring(0, 8)}`;
  return await capture.processAudioChunk(actualParticipantId, audioData);
};

/**
 * Combina os arquivos de áudio de uma sessão
 * @param {string} sessionId - ID da sessão
 * @returns {Promise<string>} - Caminho do arquivo combinado
 */
exports.combineAudioFiles = async (sessionId) => {
  if (!activeSessions.has(sessionId)) {
    throw new Error(`Sessão ${sessionId} não encontrada`);
  }
  
  const session = activeSessions.get(sessionId);
  const sessionDir = await ensureAudioDir(sessionId);
  const outputFile = path.join(sessionDir, `combined_${Date.now()}.wav`);
  
  // Se não houver arquivos, retornar erro
  if (session.audioFiles.length === 0) {
    throw new Error(`Nenhum arquivo de áudio encontrado para a sessão ${sessionId}`);
  }
  
  // Ordenar arquivos por timestamp
  const sortedFiles = [...session.audioFiles].sort((a, b) => a.timestamp - b.timestamp);
  
  return new Promise((resolve, reject) => {
    // Criar comando ffmpeg para combinar os arquivos
    const command = ffmpeg();
    
    // Adicionar cada arquivo como entrada
    sortedFiles.forEach(file => {
      command.input(file.path);
    });
    
    // Configurar a saída
    command
      .outputOptions([
        '-filter_complex amix=inputs=' + sortedFiles.length + ':dropout_transition=0:normalize=0',
        '-ac 1', // Mono
        '-ar 44100' // 44.1 kHz
      ])
      .output(outputFile)
      .on('end', () => {
        logger.info(`Arquivos de áudio combinados com sucesso: ${outputFile}`);
        resolve(outputFile);
      })
      .on('error', (err) => {
        logger.error(`Erro ao combinar arquivos de áudio: ${err.message}`, { err });
        reject(err);
      })
      .run();
  });
}; 