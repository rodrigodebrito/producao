/**
 * Arquivo de diagnóstico simplificado para encontrar a causa do crash
 */

console.log('Iniciando diagnóstico...');

// Carregar variáveis de ambiente
try {
  require('dotenv').config();
  console.log('Variáveis de ambiente carregadas com sucesso');
} catch (error) {
  console.error('Erro ao carregar variáveis de ambiente:', error);
  process.exit(1);
}

// Criar um aplicativo Express básico
try {
  const express = require('express');
  const app = express();
  console.log('Express inicializado com sucesso');

  // Rota básica
  app.get('/', (req, res) => {
    res.send('Diagnóstico funcionando');
  });

  // Iniciar o servidor
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor de diagnóstico rodando na porta ${PORT}`);
  });
} catch (error) {
  console.error('Erro ao inicializar Express:', error);
  process.exit(1);
} 