const express = require('express');
const router = express.Router();

// Log para depuração
console.log('Carregando daily-proxy.routes.js...');

// Tentar importar o controlador com try-catch para detectar erros
let dailyProxyController;
try {
  dailyProxyController = require('../controllers/daily-proxy.controller');
  console.log('Controller do Daily Proxy carregado com sucesso');
} catch (error) {
  console.error('ERRO ao carregar controller do Daily Proxy:', error.message);
  console.error('Stack:', error.stack);
  // Controlador mock para evitar crash da aplicação
  dailyProxyController = {
    captureAudio: (req, res) => res.status(500).json({ error: 'Controller não disponível' }),
    captureStatus: (req, res) => res.status(500).json({ error: 'Controller não disponível' }),
    stopCapture: (req, res) => res.status(500).json({ error: 'Controller não disponível' }),
    processAudio: (req, res) => res.status(500).json({ error: 'Controller não disponível' })
  };
}

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Rota de teste simples para verificar se o router está funcionando
router.get('/test', (req, res) => {
  res.json({ message: 'Daily Proxy Router funcionando!' });
});

// Rota para debug
router.post('/debug', (req, res) => {
  console.log('Requisição recebida em /api/daily-proxy/debug');
  console.log('Body:', req.body);
  res.json({ success: true, message: 'Debug endpoint acessado com sucesso', receivedData: req.body });
});

/**
 * @route POST /api/daily-proxy/capture
 * @desc Inicia a captura de áudio da sala do Daily.co
 * @access Privado
 */
router.post('/capture', (req, res) => {
  console.log('Requisição recebida em /api/daily-proxy/capture');
  console.log('Body:', req.body);
  
  // Chamar o controller
  try {
    dailyProxyController.captureAudio(req, res);
  } catch (error) {
    console.error('Erro ao processar captureAudio:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno ao processar a requisição',
      error: error.message
    });
  }
});

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

console.log('Rotas do Daily Proxy configuradas com sucesso');
module.exports = router; 