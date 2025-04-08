/**
 * Este arquivo serve como uma redireção para o serviço OpenAI principal
 * Mantido para compatibilidade com código existente
 */

const openAIService = require('./ai/openai.service');

// Exporta o serviço da OpenAI
module.exports = openAIService; 