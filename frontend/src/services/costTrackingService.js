/**
 * Serviço para rastreamento de custos de API em tempo real
 * Calcula o consumo estimado de recursos da OpenAI durante uma sessão
 */

class CostTrackingService {
  constructor() {
    // Inicializar contadores
    this.reset();
    
    // Definir preços dos serviços (em USD)
    this.prices = {
      whisper: 0.006, // por minuto
      gpt4oMini: {
        input: 0.0015, // por 1K tokens de entrada
        output: 0.0060, // por 1K tokens de saída
      },
      embedding: 0.0001, // por 1K tokens
    };
    
    // Flag para controlar exibição de logs
    this.enableLogs = true;
    
    console.log('🔄 CostTrackingService: Inicializado');
  }
  
  /**
   * Reinicia todos os contadores
   */
  reset() {
    this.audioMinutes = 0;
    this.tokensInput = 0;
    this.tokensOutput = 0;
    this.tokensEmbedding = 0;
    this.sessionStartTime = Date.now();
    this.apiCalls = {
      whisper: 0,
      gptAnalysis: 0,
      gptSuggestions: 0,
      gptReports: 0,
      embeddings: 0
    };
    
    if (this.enableLogs) {
      console.log('🔄 CostTrackingService: Contadores reiniciados');
    }
  }
  
  /**
   * Registra minutos de áudio transcritos pelo Whisper
   * @param {number} minutes - Minutos de áudio
   */
  trackWhisperUsage(minutes) {
    this.audioMinutes += minutes;
    this.apiCalls.whisper += 1;
    
    if (this.enableLogs) {
      console.log(`💰 CUSTO: Whisper +${minutes.toFixed(2)} minutos`);
      this.logCurrentCosts();
    }
  }
  
  /**
   * Estima o custo de processamento de texto (input + output)
   * @param {string|number} input - Texto de entrada ou número de tokens
   * @param {string|number} output - Texto de saída ou número de tokens
   * @param {string} type - Tipo de chamada ('analysis', 'suggestions', 'report')
   */
  trackGPTUsage(input, output, type = 'analysis') {
    // Converter texto para estimativa de tokens se necessário
    const inputTokens = typeof input === 'string' ? this.estimateTokens(input) : input;
    const outputTokens = typeof output === 'string' ? this.estimateTokens(output) : output;
    
    // Adicionar aos contadores
    this.tokensInput += inputTokens;
    this.tokensOutput += outputTokens;
    
    // Incrementar contador de chamadas apropriado
    if (type === 'analysis') {
      this.apiCalls.gptAnalysis += 1;
    } else if (type === 'suggestions') {
      this.apiCalls.gptSuggestions += 1;
    } else if (type === 'report') {
      this.apiCalls.gptReports += 1;
    }
    
    if (this.enableLogs) {
      console.log(`💰 CUSTO: ${type} +${(inputTokens / 1000).toFixed(2)}K tokens entrada, +${(outputTokens / 1000).toFixed(2)}K tokens saída`);
      this.logCurrentCosts();
    }
  }
  
  /**
   * Registra uso de embeddings
   * @param {string|number} text - Texto ou número de tokens
   */
  trackEmbeddingUsage(text) {
    const tokens = typeof text === 'string' ? this.estimateTokens(text) : text;
    this.tokensEmbedding += tokens;
    this.apiCalls.embeddings += 1;
    
    if (this.enableLogs) {
      console.log(`💰 CUSTO: Embedding +${(tokens / 1000).toFixed(2)}K tokens`);
      this.logCurrentCosts();
    }
  }
  
  /**
   * Estima número de tokens em um texto
   * @param {string} text - Texto para estimar tokens
   * @returns {number} - Estimativa de tokens
   */
  estimateTokens(text) {
    if (!text) return 0;
    // Uma estimativa simples: ~4 caracteres por token em média
    return Math.ceil(text.length / 4);
  }
  
  /**
   * Calcula custos atuais
   * @returns {Object} - Objeto com custos detalhados
   */
  calculateCosts() {
    // Calcular custos individuais
    const whisperCost = this.audioMinutes * this.prices.whisper;
    const gptInputCost = (this.tokensInput / 1000) * this.prices.gpt4oMini.input;
    const gptOutputCost = (this.tokensOutput / 1000) * this.prices.gpt4oMini.output;
    const embeddingCost = (this.tokensEmbedding / 1000) * this.prices.embedding;
    
    // Calcular custo total
    const totalCost = whisperCost + gptInputCost + gptOutputCost + embeddingCost;
    
    // Tempo total da sessão
    const sessionDurationMs = Date.now() - this.sessionStartTime;
    const sessionDurationMinutes = sessionDurationMs / (1000 * 60);
    
    return {
      whisper: whisperCost,
      gptInput: gptInputCost,
      gptOutput: gptOutputCost,
      embedding: embeddingCost,
      total: totalCost,
      apiCalls: this.apiCalls,
      stats: {
        audioMinutes: this.audioMinutes,
        tokensInput: this.tokensInput,
        tokensOutput: this.tokensOutput,
        tokensEmbedding: this.tokensEmbedding,
        sessionDurationMinutes
      }
    };
  }
  
  /**
   * Exibe custos atuais no console
   */
  logCurrentCosts() {
    const costs = this.calculateCosts();
    
    console.log(`
    📊 MONITORAMENTO DE CUSTOS DA SESSÃO:
    ────────────────────────────────────────
    ⏱️  Tempo de sessão: ${costs.stats.sessionDurationMinutes.toFixed(2)} minutos
    
    📝 UTILIZAÇÃO:
    • Áudio processado: ${costs.stats.audioMinutes.toFixed(2)} minutos (${costs.apiCalls.whisper} chamadas)
    • Tokens de entrada: ${(costs.stats.tokensInput / 1000).toFixed(2)}K
    • Tokens de saída: ${(costs.stats.tokensOutput / 1000).toFixed(2)}K
    • Tokens de embedding: ${(costs.stats.tokensEmbedding / 1000).toFixed(2)}K
    
    💰 CUSTOS:
    • Whisper: $${costs.whisper.toFixed(4)}
    • GPT (entrada): $${costs.gptInput.toFixed(4)}
    • GPT (saída): $${costs.gptOutput.toFixed(4)}
    • Embeddings: $${costs.embedding.toFixed(4)}
    ────────────────────────────────────────
    💵 TOTAL: $${costs.total.toFixed(4)}
    `);
  }
  
  /**
   * Fornece um relatório completo de custos
   * @returns {string} - Relatório formatado
   */
  getFullReport() {
    const costs = this.calculateCosts();
    
    return `
    === RELATÓRIO DE CUSTOS DA SESSÃO ===
    
    DURAÇÃO:
    • Tempo total: ${costs.stats.sessionDurationMinutes.toFixed(2)} minutos
    
    CHAMADAS DE API:
    • Whisper (transcrição): ${costs.apiCalls.whisper}
    • Análises: ${costs.apiCalls.gptAnalysis}
    • Sugestões: ${costs.apiCalls.gptSuggestions}
    • Relatórios: ${costs.apiCalls.gptReports}
    • Embeddings: ${costs.apiCalls.embeddings}
    
    UTILIZAÇÃO:
    • Áudio processado: ${costs.stats.audioMinutes.toFixed(2)} minutos
    • Tokens de entrada: ${costs.stats.tokensInput.toLocaleString()}
    • Tokens de saída: ${costs.stats.tokensOutput.toLocaleString()}
    • Tokens de embedding: ${costs.stats.tokensEmbedding.toLocaleString()}
    
    CUSTOS:
    • Transcrição (Whisper): $${costs.whisper.toFixed(4)}
    • GPT (processamento entrada): $${costs.gptInput.toFixed(4)}
    • GPT (geração saída): $${costs.gptOutput.toFixed(4)}
    • Busca semântica (Embeddings): $${costs.embedding.toFixed(4)}
    
    CUSTO TOTAL: $${costs.total.toFixed(4)}
    
    Obs: Estimativa baseada nos preços da OpenAI em USD
    `;
  }
}

// Exportar uma instância única para toda a aplicação
const costTracker = new CostTrackingService();
export default costTracker; 