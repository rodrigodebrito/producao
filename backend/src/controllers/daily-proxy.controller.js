const dailyProxyService = require('../services/media/daily-proxy.service');
const logger = require('../utils/logger');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configuração do Multer para upload de arquivos de áudio
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const sessionId = req.params.sessionId;
    const dir = path.join(process.cwd(), 'audio_files', sessionId, 'temp');
    
    // Garantir que o diretório existe
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `chunk-${uniqueSuffix}.webm`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // limite de 10MB
  }
});

/**
 * Inicia uma nova sessão de captura de áudio
 */
exports.captureAudio = async (req, res) => {
  try {
    const { roomUrl, participantId, participantName } = req.body;
    
    if (!roomUrl || !participantId) {
      return res.status(400).json({ 
        success: false, 
        message: 'roomUrl e participantId são obrigatórios' 
      });
    }
    
    const result = await dailyProxyService.startCapture(roomUrl, participantId, participantName);
    
    return res.status(200).json({
      success: true,
      message: 'Captura de áudio iniciada com sucesso',
      data: result
    });
  } catch (error) {
    logger.error(`Erro ao iniciar captura de áudio: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar captura de áudio',
      error: error.message
    });
  }
};

/**
 * Obtém o status de uma sessão de captura
 */
exports.captureStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId é obrigatório'
      });
    }
    
    const status = await dailyProxyService.getCaptureStatus(sessionId);
    
    if (!status) {
      return res.status(404).json({
        success: false,
        message: 'Sessão de captura não encontrada'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error(`Erro ao obter status da captura: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Erro ao obter status da captura',
      error: error.message
    });
  }
};

/**
 * Interrompe uma sessão de captura de áudio
 */
exports.stopCapture = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'sessionId é obrigatório'
      });
    }
    
    const result = await dailyProxyService.stopCapture(sessionId);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Sessão de captura não encontrada'
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Captura de áudio interrompida com sucesso',
      data: result
    });
  } catch (error) {
    logger.error(`Erro ao interromper captura de áudio: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Erro ao interromper captura de áudio',
      error: error.message
    });
  }
};

/**
 * Processa um chunk de áudio enviado pelo cliente
 */
exports.processAudio = [
  upload.single('audio'),
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { participantId, timestamp } = req.body;
      
      if (!sessionId || !participantId) {
        // Remover o arquivo se foi feito upload
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        
        return res.status(400).json({
          success: false,
          message: 'sessionId e participantId são obrigatórios'
        });
      }
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Nenhum arquivo de áudio enviado'
        });
      }
      
      const result = await dailyProxyService.processAudioChunk(
        sessionId,
        participantId,
        req.file.path,
        timestamp ? parseInt(timestamp) : Date.now()
      );
      
      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'Sessão de captura ou participante não encontrado'
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'Chunk de áudio processado com sucesso'
      });
    } catch (error) {
      logger.error(`Erro ao processar chunk de áudio: ${error.message}`);
      
      // Remover o arquivo em caso de erro
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          logger.error(`Erro ao remover arquivo temporário: ${e.message}`);
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'Erro ao processar chunk de áudio',
        error: error.message
      });
    }
  }
];