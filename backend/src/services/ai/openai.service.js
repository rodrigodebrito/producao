const OpenAI = require('openai');
require('dotenv').config();
const fs = require('fs');
const logger = require('../../utils/logger');
const tokenUsageService = require('./token-usage.service');

// Configuração do cliente OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Log de inicialização do serviço
console.log('OpenAI Service: Inicializado com sucesso - API Key configurada');

// Instruções detalhadas para cada tipo de análise
const SYSTEM_PROMPTS = {
    analysis: `Você é um assistente especializado em análise de sessões de terapia.
Ao analisar a conversa, considere:
1. Padrões emocionais e comportamentais
2. Temas recorrentes
3. Dinâmicas interpessoais
4. Possíveis áreas para exploração
5. Progresso do cliente

Forneça uma análise estruturada incluindo:
- Principais temas identificados
- Padrões observados
- Pontos de atenção
- Sugestões para próximos passos`,

    suggestions: `Você é um assistente especializado em terapia.
Seu papel é fornecer sugestões práticas e relevantes para o terapeuta com base no contexto atual da sessão.

Considere:
1. O momento atual da sessão
2. O estado emocional do cliente
3. As técnicas terapêuticas apropriadas
4. Possíveis intervenções
5. Perguntas relevantes para aprofundamento

Forneça sugestões concisas e acionáveis que o terapeuta possa usar imediatamente.`,

    report: `Você é um assistente especializado em gerar relatórios de sessões de terapia.
Crie um relatório detalhado e estruturado com as seguintes seções:

1. Resumo da Sessão
   - Data e duração
   - Temas principais abordados
   - Estado emocional do cliente

2. Desenvolvimento
   - Principais pontos discutidos
   - Insights relevantes
   - Intervenções realizadas

3. Observações Técnicas
   - Padrões identificados
   - Aspectos comportamentais
   - Dinâmicas relacionais

4. Progresso
   - Evolução observada
   - Áreas de melhoria
   - Desafios persistentes

5. Plano de Ação
   - Recomendações para próxima sessão
   - Exercícios ou tarefas sugeridas
   - Pontos a serem explorados

Mantenha um tom profissional e objetivo, focando em observações clinicamente relevantes.`
};

/**
 * Serviço para interação com a API da OpenAI
 */
const openAIService = {
    /**
     * Analisa um texto usando GPT-4
     * @param {string} text - Texto para analisar
     * @returns {Promise<string>} Análise do texto
     */
    async analyzeText(text) {
        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: SYSTEM_PROMPTS.analysis
                    },
                    {
                        role: "user",
                        content: text
                    }
                ],
                temperature: 0.2,
                max_tokens: 1500
            });

            // Registrar uso de tokens
            tokenUsageService.logTokenUsage(
                "gpt-4o-mini", 
                [{ role: "system", content: SYSTEM_PROMPTS.analysis }, { role: "user", content: text }],
                response.choices[0].message.content
            );

            return response.choices[0].message.content;
        } catch (error) {
            console.error('Erro ao analisar texto com OpenAI:', error);
            throw error;
        }
    },

    /**
     * Gera sugestões em tempo real para o terapeuta
     * @param {string} context - Contexto atual da sessão
     * @returns {Promise<string>} Sugestões para o terapeuta
     */
    async generateSuggestions(context) {
        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: SYSTEM_PROMPTS.suggestions
                    },
                    {
                        role: "user",
                        content: context
                    }
                ],
                temperature: 0.7,
                max_tokens: 300
            });

            return response.choices[0].message.content;
        } catch (error) {
            console.error('Erro ao gerar sugestões com OpenAI:', error);
            throw error;
        }
    },

    /**
     * Gera um relatório detalhado da sessão
     * @param {string} sessionContent - Conteúdo completo da sessão
     * @returns {Promise<string>} Relatório da sessão
     */
    async generateReport(sessionContent) {
        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: SYSTEM_PROMPTS.report
                    },
                    {
                        role: "user",
                        content: sessionContent
                    }
                ],
                temperature: 0.7,
                max_tokens: 1000
            });

            return response.choices[0].message.content;
        } catch (error) {
            console.error('Erro ao gerar relatório com OpenAI:', error);
            throw error;
        }
    },

    /**
     * Transcreve um arquivo de áudio/vídeo usando a API Whisper do OpenAI
     * @param {string} filePath - Caminho para o arquivo de áudio/vídeo
     * @param {string} language - Código ISO do idioma (pt, en, es, etc.)
     * @returns {Promise<string>} Texto transcrito
     */
    async transcribeAudioVideo(filePath, language = 'pt') {
        try {
            logger.info(`Iniciando transcrição de arquivo: ${filePath}`);
            
            // Criar um ReadStream do arquivo
            const file = fs.createReadStream(filePath);
            
            // Configurar o modelo Whisper com o idioma correto
            const transcriptionOptions = {
                file: file,
                model: 'whisper-1',
            };
            
            // Adicionar o idioma se for especificado
            if (language) {
                transcriptionOptions.language = language;
            }
            
            // Realizar a transcrição
            const response = await openai.audio.transcriptions.create(transcriptionOptions);
            
            logger.info(`Transcrição concluída para arquivo: ${filePath}`);
            return response.text;
        } catch (error) {
            logger.error(`Erro ao transcrever áudio/vídeo: ${filePath}`, error);
            throw new Error(`Falha na transcrição: ${error.message}`);
        }
    }
};

module.exports = openAIService; 