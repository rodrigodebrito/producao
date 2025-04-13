const express = require('express');
const router = express.Router();
const dailyProxyController = require('../controllers/daily-proxy.controller');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @route POST /api/daily-proxy/capture
 * @desc Inicia a captura de áudio da sala do Daily.co
 * @access Privado
 */
router.post('/capture', dailyProxyController.captureAudio);

/**
 * @route GET /api/daily-proxy/status/:sessionId
 * @desc Obtém o status da captura de áudio
 * @access Privado
 */
router.get('/status/:sessionId', dailyProxyController.captureStatus);

/**
 * @route POST /api/daily-proxy/stop/:sessionId
 * @desc Interrompe a captura de áudio
 * @access Privado
 */
router.post('/stop/:sessionId', dailyProxyController.stopCapture);

/**
 * @route POST /api/daily-proxy/audio/:sessionId
 * @desc Processa um chunk de áudio enviado pelo cliente
 * @access Privado
 */
router.post('/audio/:sessionId', upload.single('audio'), (req, res) => {
  const { sessionId } = req.params;
  const participantId = req.body.participantId || 'unknown';
  
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ 
      success: false, 
      message: 'Arquivo de áudio não encontrado na requisição'
    });
  }
  
  const audioData = req.file.buffer;
  
  dailyProxyController.processAudio(req, res, {
    sessionId,
    participantId,
    audioData
  });
});

module.exports = router; 