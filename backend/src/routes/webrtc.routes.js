/**
 * Rotas para o serviço WebRTC
 * Gerencia os endpoints relacionados à captura de áudio e transcrição
 */

const express = require('express');
const router = express.Router();
const webRTCController = require('../controllers/webrtc.controller');
const authMiddleware = require('../middleware/auth.middleware');
const flexAuthMiddleware = require('../middleware/flex-auth.middleware');

// API pública para WebRTC

/**
 * @route POST /api/webrtc/session/:sessionId
 * @desc Inicializa uma sessão WebRTC
 * @access Autenticado
 */
router.post(
  '/session/:sessionId',
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.initSession
);

/**
 * @route POST /api/webrtc/record/start/:sessionId
 * @desc Inicia a gravação do áudio para uma sessão
 * @access Autenticado
 */
router.post(
  '/record/start/:sessionId',
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.startRecording
);

/**
 * @route POST /api/webrtc/record/stop/:sessionId
 * @desc Para a gravação do áudio e retorna a transcrição
 * @access Autenticado
 */
router.post(
  '/record/stop/:sessionId',
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.stopRecording
);

/**
 * @route POST /api/webrtc/record/transcribe/:sessionId
 * @desc Transcreve o áudio atual sem parar a gravação
 * @access Autenticado
 */
router.post(
  '/record/transcribe/:sessionId',
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.transcribeCurrentAudio
);

/**
 * @route GET /api/webrtc/sessions
 * @desc Lista todas as sessões WebRTC ativas
 * @access Autenticado
 */
router.get(
  '/sessions',
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.getActiveSessions
);

/**
 * @route DELETE /api/webrtc/session/:sessionId
 * @desc Encerra uma sessão WebRTC
 * @access Autenticado
 */
router.delete(
  '/session/:sessionId',
  authMiddleware,
  flexAuthMiddleware,
  webRTCController.closeSession
);

module.exports = router; 