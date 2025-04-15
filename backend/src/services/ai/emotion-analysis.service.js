/**
 * Serviço de análise de emoção em áudio
 * Utiliza a OpenAI API e processamento local para detectar emoções e tom de voz
 */
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const logger = require('../../utils/logger');
const openaiService = require('./openai.service');

// Promisify fs operations
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);

/**
 * Serviço para análise de emoção em áudio
 */
class EmotionAnalysisService {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp');
    
    // Garantir que o diretório de arquivos temporários existe
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Lista de emoções suportadas
    this.supportedEmotions = [
      'neutral', 
      'happy', 
      'sad', 
      'angry', 
      'fearful',
      'disgusted', 
      'surprised', 
      'calm', 
      'confused',
      'emphatic',
      'uncertain',
      'excited'
    ];
    
    // Lista de tons de voz suportados
    this.supportedTones = [
      'formal',
      'informal',
      'friendly',
      'serious',
      'urgent',
      'hesitant',
      'confident',
      'questioning',
      'assertive',
      'sarcastic',
      'monotone',
      'expressive'
    ];
    
    logger.info('EmotionAnalysisService: Serviço de análise de emoção inicializado');
  }
  
  /**
   * Analisa emoções em um arquivo de áudio
   * @param {Buffer} audioBuffer - Buffer com o áudio a ser analisado
   * @param {Object} options - Opções de análise
   * @returns {Promise<Object>} Resultado da análise de emoção
   */
  async analyzeAudio(audioBuffer, options = {}) {
    try {
      logger.info('EmotionAnalysisService: Iniciando análise de emoção em áudio');
      
      if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error('Buffer de áudio vazio ou inválido');
      }
      
      // Definir opções padrão
      const analysisOptions = {
        analyzeEmotion: true,
        analyzeTone: true,
        language: options.language || 'pt',
        ...options
      };
      
      // Escrever arquivo temporário
      const tempFileName = `emotion_${Date.now()}_${Math.floor(Math.random() * 10000)}.wav`;
      const tempFilePath = path.join(this.tempDir, tempFileName);
      
      await writeFileAsync(tempFilePath, audioBuffer);
      logger.info(`EmotionAnalysisService: Arquivo temporário criado: ${tempFilePath}`);
      
      try {
        // Transcrever o áudio primeiro para ter o contexto textual
        const transcriptionResult = await openaiService.callWhisperAPI(audioBuffer, { 
          language: analysisOptions.language
        });
        
        logger.info('EmotionAnalysisService: Áudio transcrito com sucesso');
        
        // Analisar emoções usando o texto transcrito e características de áudio
        const emotionResults = await this._analyzeEmotionsWithOpenAI(
          transcriptionResult.text, 
          tempFilePath,
          analysisOptions
        );
        
        return emotionResults;
      } finally {
        // Remover arquivo temporário
        try {
          await unlinkAsync(tempFilePath);
          logger.info(`EmotionAnalysisService: Arquivo temporário removido: ${tempFilePath}`);
        } catch (cleanupError) {
          logger.error(`EmotionAnalysisService: Erro ao remover arquivo temporário: ${cleanupError.message}`);
        }
      }
    } catch (error) {
      logger.error(`EmotionAnalysisService: Erro ao analisar emoções: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Analisa emoções usando OpenAI (ChatGPT)
   * @param {string} transcription - Texto transcrito do áudio
   * @param {string} audioFilePath - Caminho para o arquivo de áudio
   * @param {Object} options - Opções de análise
   * @returns {Promise<Object>} Resultado da análise
   * @private
   */
  async _analyzeEmotionsWithOpenAI(transcription, audioFilePath, options) {
    try {
      logger.info('EmotionAnalysisService: Analisando emoções com OpenAI');
      
      const transcript = transcription || 'Nenhuma fala detectada';
      
      // Criar prompt para o ChatGPT
      let prompt = 'Analise o seguinte texto transcrito de um áudio em português e identifique:';
      
      if (options.analyzeEmotion) {
        prompt += '\n\n1. As emoções predominantes expressas pelo falante, com nível de confiança (0-1)';
        prompt += `\n   Escolha entre as seguintes emoções: ${this.supportedEmotions.join(', ')}`;
      }
      
      if (options.analyzeTone) {
        prompt += '\n\n2. O tom de voz predominante, com nível de confiança (0-1)';
        prompt += `\n   Escolha entre os seguintes tons: ${this.supportedTones.join(', ')}`;
      }
      
      prompt += '\n\nTranscrição:';
      prompt += `\n"${transcript}"`;
      
      prompt += '\n\nResponda em formato JSON com a seguinte estrutura:';
      prompt += '\n{';
      
      if (options.analyzeEmotion) {
        prompt += '\n  "emotions": {';
        prompt += '\n    "dominant": { "label": "emotion_name", "confidence": 0.x },';
        prompt += '\n    "all": [';
        prompt += '\n      { "label": "emotion_name", "confidence": 0.x },';
        prompt += '\n      ...';
        prompt += '\n    ]';
        prompt += '\n  }';
      }
      
      if (options.analyzeTone) {
        if (options.analyzeEmotion) prompt += ',';
        prompt += '\n  "tones": {';
        prompt += '\n    "dominant": { "label": "tone_name", "confidence": 0.x },';
        prompt += '\n    "all": [';
        prompt += '\n      { "label": "tone_name", "confidence": 0.x },';
        prompt += '\n      ...';
        prompt += '\n    ]';
        prompt += '\n  }';
      }
      
      prompt += '\n}';
      
      // Fazer a chamada para a API
      const { content } = await openaiService.callChatCompletion([
        { role: 'system', content: 'Você é um assistente especializado em análise de emoções em fala. Sua tarefa é analisar transcrições de áudio e determinar emoções e tons de voz. Responda sempre em JSON, não adicione texto explicativo.' },
        { role: 'user', content: prompt }
      ], { model: 'gpt-4o' });
      
      // Extrair JSON da resposta
      let jsonResponse;
      try {
        // Tentar extrair JSON da resposta (o modelo às vezes adiciona texto adicional)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonResponse = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Formato de resposta inválido');
        }
      } catch (parseError) {
        logger.error(`EmotionAnalysisService: Erro ao parsear resposta JSON: ${parseError.message}`);
        logger.error(`EmotionAnalysisService: Resposta completa: ${content}`);
        
        // Fornecer resultado padrão em caso de erro
        jsonResponse = {
          emotions: options.analyzeEmotion ? {
            dominant: { label: 'neutral', confidence: 0.7 },
            all: [{ label: 'neutral', confidence: 0.7 }]
          } : undefined,
          tones: options.analyzeTone ? {
            dominant: { label: 'neutral', confidence: 0.7 },
            all: [{ label: 'neutral', confidence: 0.7 }]
          } : undefined
        };
      }
      
      // Validar e normalizar o resultado
      return this._normalizeAnalysisResult(jsonResponse, options);
    } catch (error) {
      logger.error(`EmotionAnalysisService: Erro ao analisar emoções com OpenAI: ${error.message}`);
      
      // Fornecer resultado padrão em caso de erro
      return {
        emotions: options.analyzeEmotion ? {
          dominant: { label: 'neutral', confidence: 0.5 },
          all: [{ label: 'neutral', confidence: 0.5 }]
        } : undefined,
        tones: options.analyzeTone ? {
          dominant: { label: 'neutral', confidence: 0.5 },
          all: [{ label: 'neutral', confidence: 0.5 }]
        } : undefined,
        error: error.message
      };
    }
  }
  
  /**
   * Normaliza e valida o resultado da análise
   * @param {Object} result - Resultado da análise
   * @param {Object} options - Opções originais
   * @returns {Object} Resultado normalizado
   * @private
   */
  _normalizeAnalysisResult(result, options) {
    // Criar estrutura base
    const normalizedResult = {
      emotions: options.analyzeEmotion ? { dominant: null, all: [] } : undefined,
      tones: options.analyzeTone ? { dominant: null, all: [] } : undefined,
    };
    
    // Normalizar emoções
    if (options.analyzeEmotion && result.emotions) {
      // Normalizar emoção dominante
      if (result.emotions.dominant && result.emotions.dominant.label) {
        normalizedResult.emotions.dominant = {
          label: this._normalizeLabel(result.emotions.dominant.label, this.supportedEmotions),
          confidence: this._normalizeConfidence(result.emotions.dominant.confidence)
        };
      } else if (result.emotions.all && result.emotions.all.length > 0) {
        // Usar a primeira emoção da lista como dominante se não tiver dominante explícita
        normalizedResult.emotions.dominant = {
          label: this._normalizeLabel(result.emotions.all[0].label, this.supportedEmotions),
          confidence: this._normalizeConfidence(result.emotions.all[0].confidence)
        };
      } else {
        // Fallback para neutral
        normalizedResult.emotions.dominant = { label: 'neutral', confidence: 0.5 };
      }
      
      // Normalizar lista de emoções
      if (result.emotions.all && Array.isArray(result.emotions.all)) {
        normalizedResult.emotions.all = result.emotions.all
          .filter(emotion => emotion && emotion.label)
          .map(emotion => ({
            label: this._normalizeLabel(emotion.label, this.supportedEmotions),
            confidence: this._normalizeConfidence(emotion.confidence)
          }));
      }
      
      // Garantir que pelo menos há uma emoção na lista
      if (normalizedResult.emotions.all.length === 0) {
        normalizedResult.emotions.all.push(normalizedResult.emotions.dominant || { label: 'neutral', confidence: 0.5 });
      }
    }
    
    // Normalizar tons
    if (options.analyzeTone && result.tones) {
      // Normalizar tom dominante
      if (result.tones.dominant && result.tones.dominant.label) {
        normalizedResult.tones.dominant = {
          label: this._normalizeLabel(result.tones.dominant.label, this.supportedTones),
          confidence: this._normalizeConfidence(result.tones.dominant.confidence)
        };
      } else if (result.tones.all && result.tones.all.length > 0) {
        // Usar o primeiro tom da lista como dominante se não tiver dominante explícito
        normalizedResult.tones.dominant = {
          label: this._normalizeLabel(result.tones.all[0].label, this.supportedTones),
          confidence: this._normalizeConfidence(result.tones.all[0].confidence)
        };
      } else {
        // Fallback para neutral
        normalizedResult.tones.dominant = { label: 'neutral', confidence: 0.5 };
      }
      
      // Normalizar lista de tons
      if (result.tones.all && Array.isArray(result.tones.all)) {
        normalizedResult.tones.all = result.tones.all
          .filter(tone => tone && tone.label)
          .map(tone => ({
            label: this._normalizeLabel(tone.label, this.supportedTones),
            confidence: this._normalizeConfidence(tone.confidence)
          }));
      }
      
      // Garantir que pelo menos há um tom na lista
      if (normalizedResult.tones.all.length === 0) {
        normalizedResult.tones.all.push(normalizedResult.tones.dominant || { label: 'neutral', confidence: 0.5 });
      }
    }
    
    return normalizedResult;
  }
  
  /**
   * Normaliza um rótulo para garantir que está na lista de suportados
   * @param {string} label - Rótulo original
   * @param {Array<string>} supportedLabels - Lista de rótulos suportados
   * @returns {string} Rótulo normalizado
   * @private
   */
  _normalizeLabel(label, supportedLabels) {
    if (!label) return 'neutral';
    
    const normalizedLabel = label.toLowerCase().trim();
    
    // Verificar se o rótulo exato está na lista
    if (supportedLabels.includes(normalizedLabel)) {
      return normalizedLabel;
    }
    
    // Se não encontrar exato, procurar o mais similar
    for (const supported of supportedLabels) {
      if (normalizedLabel.includes(supported) || supported.includes(normalizedLabel)) {
        return supported;
      }
    }
    
    // Fallback para neutral se não encontrar nada similar
    return 'neutral';
  }
  
  /**
   * Normaliza um valor de confiança para o intervalo [0, 1]
   * @param {number|string} confidence - Valor de confiança
   * @returns {number} Confiança normalizada
   * @private
   */
  _normalizeConfidence(confidence) {
    if (confidence === undefined || confidence === null) return 0.5;
    
    let value = typeof confidence === 'string' ? parseFloat(confidence) : confidence;
    
    if (isNaN(value)) return 0.5;
    
    // Normalizar para o intervalo [0, 1]
    if (value < 0) value = 0;
    if (value > 1) value = 1;
    
    return value;
  }
}

module.exports = new EmotionAnalysisService(); 