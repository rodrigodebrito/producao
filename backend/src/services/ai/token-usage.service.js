/**
 * Serviço para monitoramento de uso de tokens e custos com a API da OpenAI
 */

const fs = require('fs');
const path = require('path');
const { encode } = require('gpt-3-encoder');

// Preços por milhão de tokens (atualizado em 2024)
const PRICE_PER_MILLION_TOKENS = {
  'gpt-4o-mini': {
    input: 0.60,
    output: 1.80
  },
  'gpt-4o': {
    input: 2.50,
    output: 10.00
  },
  'gpt-4-turbo': {
    input: 2.50,
    output: 7.50
  },
  'gpt-3.5-turbo': {
    input: 0.50,
    output: 1.50
  }
};

// Caminho do arquivo de log de uso
const LOG_FILE_PATH = path.join(__dirname, '../../../logs/token-usage.json');

class TokenUsageService {
  constructor() {
    this.usageData = this.loadUsageData();
    this.ensureLogDirectory();
  }

  /**
   * Garante que o diretório de logs existe
   */
  ensureLogDirectory() {
    const logDir = path.dirname(LOG_FILE_PATH);
    // Habilitando criação de diretório
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    console.log('Diretório de logs:', logDir, '(criação automática habilitada)');
  }

  /**
   * Carrega dados de uso existentes ou cria um novo objeto
   */
  loadUsageData() {
    try {
      if (fs.existsSync(LOG_FILE_PATH)) {
        return JSON.parse(fs.readFileSync(LOG_FILE_PATH, 'utf8'));
      }
    } catch (error) {
      console.error('Erro ao carregar dados de uso:', error);
    }

    // Estrutura inicial se não existir arquivo
    return {
      totalUsage: {
        tokens: {
          input: 0,
          output: 0
        },
        cost: {
          input: 0,
          output: 0,
          total: 0
        }
      },
      modelUsage: {},
      dailyUsage: {},
      lastUpdate: new Date().toISOString()
    };
  }

  /**
   * Salva os dados de uso atualizados
   */
  saveUsageData() {
    try {
      fs.writeFileSync(LOG_FILE_PATH, JSON.stringify(this.usageData, null, 2));
    } catch (error) {
      console.error('Erro ao salvar dados de uso:', error);
    }
  }

  /**
   * Estima o número de tokens em um texto
   * @param {string} text - Texto para estimar tokens
   * @returns {number} - Número estimado de tokens
   */
  estimateTokens(text) {
    if (!text) return 0;
    try {
      return encode(text).length;
    } catch (error) {
      console.error('Erro ao estimar tokens:', error);
      // Estimativa aproximada: 4 caracteres = 1 token (média)
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Estima tokens para um array de mensagens
   * @param {Array} messages - Array de mensagens para estimar tokens
   * @returns {number} - Número estimado de tokens
   */
  estimateMessagesTokens(messages) {
    if (!messages || !Array.isArray(messages)) return 0;
    
    let total = 0;
    for (const msg of messages) {
      if (msg.content) {
        total += this.estimateTokens(msg.content);
      }
    }
    // Adiciona tokens para metadados das mensagens (~4 tokens por mensagem)
    total += messages.length * 4;
    
    return total;
  }

  /**
   * Registra o uso de tokens para uma chamada à API
   * @param {string} modelName - Nome do modelo usado
   * @param {Array} inputMessages - Mensagens de entrada
   * @param {string} outputContent - Conteúdo da resposta
   */
  logTokenUsage(modelName, inputMessages, outputContent) {
    const today = new Date().toISOString().split('T')[0];
    const model = modelName || 'unknown';
    
    // Estimar tokens
    const inputTokens = this.estimateMessagesTokens(inputMessages);
    const outputTokens = outputContent ? this.estimateTokens(outputContent) : 0;
    
    // Calcular custo
    const prices = PRICE_PER_MILLION_TOKENS[model] || PRICE_PER_MILLION_TOKENS['gpt-3.5-turbo'];
    const inputCost = (inputTokens / 1000000) * prices.input;
    const outputCost = (outputTokens / 1000000) * prices.output;
    const totalCost = inputCost + outputCost;
    
    // Atualizar uso total
    this.usageData.totalUsage.tokens.input += inputTokens;
    this.usageData.totalUsage.tokens.output += outputTokens;
    this.usageData.totalUsage.cost.input += inputCost;
    this.usageData.totalUsage.cost.output += outputCost;
    this.usageData.totalUsage.cost.total += totalCost;
    
    // Inicializar uso por modelo se não existir
    if (!this.usageData.modelUsage[model]) {
      this.usageData.modelUsage[model] = {
        tokens: { input: 0, output: 0 },
        cost: { input: 0, output: 0, total: 0 }
      };
    }
    
    // Atualizar uso por modelo
    this.usageData.modelUsage[model].tokens.input += inputTokens;
    this.usageData.modelUsage[model].tokens.output += outputTokens;
    this.usageData.modelUsage[model].cost.input += inputCost;
    this.usageData.modelUsage[model].cost.output += outputCost;
    this.usageData.modelUsage[model].cost.total += totalCost;
    
    // Inicializar uso diário se não existir
    if (!this.usageData.dailyUsage[today]) {
      this.usageData.dailyUsage[today] = {
        tokens: { input: 0, output: 0 },
        cost: { input: 0, output: 0, total: 0 },
        models: {}
      };
    }
    
    // Inicializar uso do modelo no dia se não existir
    if (!this.usageData.dailyUsage[today].models[model]) {
      this.usageData.dailyUsage[today].models[model] = {
        tokens: { input: 0, output: 0 },
        cost: { input: 0, output: 0, total: 0 }
      };
    }
    
    // Atualizar uso diário
    this.usageData.dailyUsage[today].tokens.input += inputTokens;
    this.usageData.dailyUsage[today].tokens.output += outputTokens;
    this.usageData.dailyUsage[today].cost.input += inputCost;
    this.usageData.dailyUsage[today].cost.output += outputCost;
    this.usageData.dailyUsage[today].cost.total += totalCost;
    
    // Atualizar uso do modelo no dia
    this.usageData.dailyUsage[today].models[model].tokens.input += inputTokens;
    this.usageData.dailyUsage[today].models[model].tokens.output += outputTokens;
    this.usageData.dailyUsage[today].models[model].cost.input += inputCost;
    this.usageData.dailyUsage[today].models[model].cost.output += outputCost;
    this.usageData.dailyUsage[today].models[model].cost.total += totalCost;
    
    // Atualizar timestamp
    this.usageData.lastUpdate = new Date().toISOString();
    
    // Salvar dados atualizados
    this.saveUsageData();
    
    // Registrar no console para debug
    console.log(`Token usage - ${model}: ${inputTokens} input, ${outputTokens} output tokens. Cost: $${totalCost.toFixed(5)}`);
    
    return {
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      cost: { input: inputCost, output: outputCost, total: totalCost }
    };
  }

  /**
   * Obtém um relatório de uso com economia comparando diferentes modelos
   * @returns {Object} - Relatório de uso e economia
   */
  getUsageReport() {
    // Calcular economia em comparação com GPT-4-turbo
    const gpt4oMiniUsage = this.usageData.modelUsage['gpt-4o-mini'] || { 
      tokens: { input: 0, output: 0 }, 
      cost: { total: 0 } 
    };
    
    // Calcular quanto custaria se fosse GPT-4-turbo
    const gpt4TurboPrices = PRICE_PER_MILLION_TOKENS['gpt-4-turbo'];
    const gpt4TurboEquivalentCost = 
      (gpt4oMiniUsage.tokens.input / 1000000) * gpt4TurboPrices.input +
      (gpt4oMiniUsage.tokens.output / 1000000) * gpt4TurboPrices.output;
    
    const savings = gpt4TurboEquivalentCost - gpt4oMiniUsage.cost.total;
    const savingsPercentage = gpt4TurboEquivalentCost > 0 
      ? (savings / gpt4TurboEquivalentCost) * 100 
      : 0;
    
    return {
      totalUsage: this.usageData.totalUsage,
      modelUsage: this.usageData.modelUsage,
      dailyUsage: this.usageData.dailyUsage,
      lastUpdate: this.usageData.lastUpdate,
      savings: {
        amount: savings,
        percentage: savingsPercentage,
        comparedTo: 'gpt-4-turbo',
        equivalentCost: gpt4TurboEquivalentCost
      }
    };
  }
}

module.exports = new TokenUsageService(); 