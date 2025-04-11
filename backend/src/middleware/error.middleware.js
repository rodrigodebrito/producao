const { createLogger } = require('../utils/logger');
const logger = createLogger('error-middleware');

// Middleware para tratamento de erros
const errorHandler = (err, req, res, next) => {
  logger.error('Erro na aplicação:', err);

  // Erro de validação do Prisma
  if (err.code === 'P2002') {
    return res.status(400).json({
      message: 'Já existe um registro com este valor único'
    });
  }

  // Erro de registro não encontrado no Prisma
  if (err.code === 'P2025') {
    return res.status(404).json({
      message: 'Registro não encontrado'
    });
  }

  // Erro de autenticação
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      message: 'Token inválido'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      message: 'Token expirado'
    });
  }

  // Erro de validação
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      message: 'Dados inválidos',
      errors: err.errors
    });
  }

  // Erro padrão
  return res.status(500).json({
    message: 'Erro interno do servidor'
  });
};

module.exports = errorHandler; 