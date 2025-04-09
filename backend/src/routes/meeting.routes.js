/**
 * Rotas para gerenciamento de videoconferências
 */

const express = require('express');
const router = express.Router();
const meetingController = require('../controllers/meeting.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Middleware para verificar se o usuário está autenticado
// router.use(authenticate);

// Rota pública para validação de sala
/**
 * @route GET /api/meetings/validate-room/:roomName
 * @desc Verifica se uma sala existe e a cria se necessário
 * @access Público - Qualquer pessoa pode validar uma sala
 */
router.get('/validate-room/:roomName', async (req, res) => {
  try {
    const { roomName } = req.params;
    
    if (!roomName) {
      return res.status(400).json({
        success: false,
        message: 'Nome da sala não fornecido'
      });
    }
    
    // Importar o serviço Daily
    const dailyService = require('../services/daily.service');
    
    // Validar e obter sala (cria se não existir)
    const result = await dailyService.validateAndGetRoom(roomName);
    
    res.status(200).json({
      success: true,
      roomName: result.name,
      url: result.url
    });
  } catch (error) {
    console.error('Erro ao validar sala Daily.co:', error);
    res.status(500).json({
      success: false,
      message: 'Falha ao validar sala Daily.co',
      error: error.message
    });
  }
});

// Aplicar autenticação apenas para as rotas protegidas
router.use(authenticate);

/**
 * @route POST /api/meetings
 * @desc Cria uma nova reunião para uma sessão
 * @access Privado - Terapeuta e Cliente
 */
router.post('/', meetingController.createMeeting);

/**
 * @route GET /api/meetings/:sessionId/join
 * @desc Gera token para entrar em uma reunião
 * @access Privado - Terapeuta e Cliente da sessão
 */
router.get('/:sessionId/join', meetingController.joinMeeting);

/**
 * @route POST /api/meetings/:sessionId/end
 * @desc Encerra uma reunião ativa
 * @access Privado - Apenas o Terapeuta
 */
router.post('/:sessionId/end', meetingController.endMeeting);

/**
 * @route GET /api/meetings/:sessionId/status
 * @desc Verifica o status de uma reunião
 * @access Privado - Terapeuta e Cliente da sessão
 */
router.get('/:sessionId/status', meetingController.getMeetingStatus);

/**
 * @route POST /api/meetings/daily-room
 * @desc Cria uma nova sala usando a API do Daily.co
 * @access Privado - Qualquer usuário autenticado
 */
router.post('/daily-room', async (req, res) => {
  try {
    const { roomName } = req.body;
    
    // Importar o serviço Daily
    const dailyService = require('../services/daily.service');
    
    // Criar sala via API do Daily
    const result = await dailyService.createRoom(roomName);
    
    res.status(200).json({
      success: true,
      message: 'Sala Daily.co criada com sucesso',
      roomName: result.name,
      url: result.url
    });
  } catch (error) {
    console.error('Erro ao criar sala Daily.co:', error);
    res.status(500).json({
      success: false,
      message: 'Falha ao criar sala Daily.co',
      error: error.message
    });
  }
});

module.exports = router; 