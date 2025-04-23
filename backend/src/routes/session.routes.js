const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const sessionController = require('../controllers/session.controller');
const { authenticate } = require('../middleware/auth.middleware');
const prisma = require('../utils/prisma');

// Middleware para validar criação de sessão
const validateSessionCreate = [
  body('appointmentId').notEmpty().withMessage('ID do agendamento é obrigatório'),
  body('title').optional(),
  body('scheduledDuration').optional().isInt().withMessage('Duração deve ser um número inteiro'),
  body('toolsUsed').optional().isObject().withMessage('Ferramentas utilizadas deve ser um objeto')
];

// Middleware para validar notas da sessão
const validateSessionNotes = [
  body('notes').notEmpty().withMessage('Notas são obrigatórias')
];

// Middleware para validar cancelamento
const validateSessionCancel = [
  body('reason').optional().isString().withMessage('Motivo deve ser um texto')
];

// Rota administrativa para verificar/criar campos do Dyte
router.get('/admin/check-dyte-fields', async (req, res) => {
  try {
    // Verificar se os campos dyteMeetingId e dyteRoomName existem na tabela Session
    const tableName = 'Session';
    const columns = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = ${tableName}
      AND column_name IN ('dyteMeetingId', 'dyteRoomName')
    `;

    const missingColumns = [];
    if (!columns.find(col => col.column_name === 'dyteMeetingId')) {
      missingColumns.push('dyteMeetingId');
    }
    if (!columns.find(col => col.column_name === 'dyteRoomName')) {
      missingColumns.push('dyteRoomName');
    }

    // Se não existirem, criar os campos
    if (missingColumns.length > 0) {
      for (const column of missingColumns) {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "Session" ADD COLUMN "${column}" TEXT
        `);
      }
      return res.json({ message: 'Campos do Dyte criados com sucesso', createdFields: missingColumns });
    }

    return res.json({ message: 'Campos do Dyte já existem', existingFields: columns.map(col => col.column_name) });
  } catch (error) {
    console.error('Erro ao verificar/criar campos do Dyte:', error);
    return res.status(500).json({ message: 'Erro ao verificar/criar campos do Dyte' });
  }
});

// Rotas protegidas com autenticação
router.use(authenticate);

// Criar uma sessão de teste (para terapeutas)
router.post('/test', sessionController.createTestSession);

// Criar uma nova sessão
router.post('/', validateSessionCreate, sessionController.createSession);

// Obter sessão por ID
router.get('/:id', sessionController.getSessionById);

// Listar sessões do usuário (terapeuta ou cliente)
router.get('/', sessionController.getUserSessions);

// Iniciar sessão
router.post('/:id/start', sessionController.startSession);

// Pausar sessão
router.post('/:id/pause', sessionController.pauseSession);

// Retomar sessão
router.post('/:id/resume', sessionController.resumeSession);

// Finalizar sessão
router.post('/:id/end', sessionController.endSession);

// Cancelar sessão
router.post('/:id/cancel', validateSessionCancel, sessionController.cancelSession);

// Atualizar notas
router.patch('/:id/notes', validateSessionNotes, sessionController.updateSessionNotes);

/**
 * @route GET /api/sessions/appointment/:appointmentId
 * @desc Busca uma sessão por ID de agendamento
 * @access Privado - Cliente e Terapeuta do agendamento
 */
router.get('/appointment/:appointmentId', sessionController.getSessionByAppointment);

module.exports = router; 