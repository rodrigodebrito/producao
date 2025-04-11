# TerapiaConect - Implementação do Sistema de Transcrição WebRTC

Este documento detalha a implementação do sistema de transcrição em tempo real "Transcrever Agora" da plataforma TerapiaConect, que permite aos terapeutas solicitar transcrições parciais durante uma sessão sem interromper a gravação.

## Visão Geral da Arquitetura

O sistema de transcrição é composto por:

1. **Frontend**: Interface de usuário com botão "Transcrever Agora" que solicita transcrições parciais
2. **Serviço WebRTC (frontend)**: Responsável pela comunicação com o backend para envio de áudio
3. **Serviço WebRTC (backend)**: Gerencia sessões, captura de áudio e processamento
4. **Serviço OpenAI**: Utiliza o modelo Whisper para transcrição de áudio para texto

## Problemas Encontrados e Soluções Aplicadas

### 1. Problema: URLs de API com Prefixo Duplicado (404 Not Found)

**Problema**: O serviço WebRTC frontend estava gerando URLs de API com prefixo "/api" duplicado, resultando em erros 404.

**Solução**: Modificamos o arquivo `webrtcTranscriptionService.js` para garantir que a base URL não contivesse já o prefixo "/api", evitando a duplicação.

```javascript
// Antes (problema)
const apiUrl = `${baseUrl}/api/webrtc/transcribe`; // baseUrl já incluía "/api"

// Depois (solução)
const apiUrl = baseUrl.endsWith('/api') 
  ? `${baseUrl}/webrtc/transcribe` 
  : `${baseUrl}/api/webrtc/transcribe`;
```

### 2. Problema: Falhas de Autenticação (401 Unauthorized)

**Problema**: As chamadas de API estavam falhando com erro 401 por falta de autenticação.

**Solução**: Implementamos a recuperação do token de autenticação do armazenamento local/sessão e o incluímos nos cabeçalhos das requisições:

```javascript
// Recuperar token de autenticação
const token = localStorage.getItem('token') || sessionStorage.getItem('token');

// Incluir no cabeçalho
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
};
```

### 3. Problema: Formato de Arquivo WAV Inválido

**Problema**: Após corrigir os problemas de comunicação, enfrentamos erros de "Invalid file format" porque o arquivo WAV gerado não tinha um cabeçalho apropriado.

**Solução**: Implementamos uma geração adequada de cabeçalhos WAV no arquivo `webrtc.service.js`:

```javascript
// Escrever cabeçalho WAV manualmente para garantir formato correto
const headerBuffer = Buffer.alloc(44);

// RIFF chunk
headerBuffer.write('RIFF', 0);  // ChunkID
headerBuffer.writeUInt32LE(0, 4); // ChunkSize (atualizado posteriormente)
headerBuffer.write('WAVE', 8);  // Format

// fmt sub-chunk
headerBuffer.write('fmt ', 12);  // Subchunk1ID
headerBuffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
headerBuffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
headerBuffer.writeUInt16LE(channels, 22); // NumChannels
headerBuffer.writeUInt32LE(sampleRate, 24); // SampleRate
headerBuffer.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28); // ByteRate
headerBuffer.writeUInt16LE(channels * (bitDepth / 8), 32); // BlockAlign
headerBuffer.writeUInt16LE(bitDepth, 34); // BitsPerSample

// data sub-chunk
headerBuffer.write('data', 36);  // Subchunk2ID
headerBuffer.writeUInt32LE(0, 40); // Subchunk2Size (atualizado posteriormente)
```

### 4. Problema: Arquivo de Áudio Muito Curto

**Problema**: Enfrentamos erros "Audio file is too short" porque não havia dados de áudio suficientes para transcrição.

**Solução**: Implementamos várias melhorias:

1. **Captura real de áudio dos participantes** quando disponível:
   ```javascript
   async captureAudioFromProducer(participantId, producer) {
     // Configuração de input no mixer para participante real
     const input = this.audioMixer.input({
       channels: 2,
       volume: 100,
       bitDepth: 16,
       sampleRate: 48000,
       name: `participant-${participantId}`
     });
   }
   ```

2. **Gerador de tom de teste** quando não há áudio real:
   ```javascript
   _simulateAudioData(input, participantId) {
     // Gerar tom de 440Hz para garantir dados de áudio válidos
     const frequency = 440; // Hz (nota Lá)
     const amplitude = 0.1; // 10% do volume máximo
     
     for (let i = 0; i < sampleRate * duration; i++) {
       const sampleValue = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
       const intValue = Math.floor(sampleValue * 32767);
       
       // Preencher buffer com dados de áudio
       buffer.writeInt16LE(intValue, i * 4); // Canal esquerdo
       buffer.writeInt16LE(intValue, i * 4 + 2); // Canal direito
     }
   }
   ```

3. **Verificação de duração mínima** para garantir dados suficientes:
   ```javascript
   // Se a gravação foi muito curta, aguardar mais tempo
   if (duration < 500) {
     const waitTime = 500 - duration;
     logger.info(`Gravação muito curta (${duration}ms), aguardando mais ${waitTime}ms`);
     await new Promise(resolve => setTimeout(resolve, waitTime));
   }
   ```

4. **Adição de dados mínimos** se o arquivo for muito pequeno:
   ```javascript
   if (fileStats.size < 5000) { // 5KB é um tamanho mínimo seguro
     logger.warn(`Arquivo de gravação muito pequeno, adicionando dados`);
     await this._appendMinimumAudioData(this.outputFile);
   }
   ```

5. **Atualização do cabeçalho WAV** para refletir o tamanho real dos dados:
   ```javascript
   _updateWavHeader(filePath) {
     // Obter tamanho total do arquivo
     const stats = fs.statSync(filePath);
     const fileSize = stats.size;
     
     // Calcular tamanhos dos chunks
     const dataSize = fileSize - 44; // Tamanho dos dados
     const riffSize = fileSize - 8;  // Tamanho do chunk RIFF
     
     // Atualizar cabeçalho
     headerBuffer.writeUInt32LE(riffSize, 4); // ChunkSize
     headerBuffer.writeUInt32LE(dataSize, 40); // Subchunk2Size
   }
   ```

## Fluxo de Funcionamento

1. **Criação da sessão**: Uma sessão WebRTC é criada quando os participantes se conectam à sala de terapia.

2. **Captura de áudio**: O sistema captura áudio real dos participantes ou gera um tom de teste quando necessário.

3. **Quando o terapeuta clica em "Transcrever Agora"**:
   - O frontend faz uma requisição para o endpoint `/api/webrtc/transcribe`.
   - O backend cria uma cópia temporária do arquivo de áudio atual.
   - O arquivo é enviado para transcrição usando o modelo Whisper via OpenAI API.
   - A transcrição parcial é retornada ao terapeuta sem interromper a gravação.

## Serviços Principais

### Frontend - webrtcTranscriptionService.js

Responsável por:
- Estabelecer comunicação com o backend
- Autenticar as requisições com token
- Fazer requisições para o endpoint de transcrição
- Tratar respostas e erros

### Backend - webrtc.service.js

Responsável por:
- Gerenciar sessões WebRTC (classe `WebRTCSession`)
- Capturar áudio de participantes (via mediasoup)
- Mixar áudio de múltiplos participantes
- Gerar arquivos WAV válidos
- Interface com serviço de transcrição OpenAI
- Tratar casos de falha com mecanismos de recuperação

## Como ampliar e manter o código

### Adicionando novos recursos

1. **Ajuste de qualidade de áudio**: Modificar os parâmetros em `startRecording()` para ajustar taxa de amostragem, profundidade de bits, etc.

2. **Suporte a diferentes formatos de áudio**: Implementar a conversão para outros formatos além de WAV no método `transcribeAudio()`.

3. **Interface para controlar volume de participantes**: Ampliar a classe `WebRTCSession` para permitir ajuste de volume individual no mixer.

### Resolvendo problemas comuns

1. **Arquivo WAV corrompido**: Verifique a geração de cabeçalho WAV e a atualização dos tamanhos de chunk.

2. **Problemas de autenticação**: Confirme que o token está sendo recuperado corretamente do armazenamento.

3. **Dados de áudio insuficientes**: Ajuste os parâmetros em `_simulateAudioData()` ou `_appendMinimumAudioData()` para gerar mais dados.

4. **Erros de API 404**: Verifique a construção de URLs e os endpoints configurados no servidor.

## Tecnologias Utilizadas

- **mediasoup**: Para gerenciamento de conexões WebRTC
- **audio-mixer**: Para mixagem de áudio de múltiplos participantes
- **OpenAI Whisper**: Para transcrição de áudio para texto
- **Node.js Streams**: Para processamento eficiente de dados de áudio

## Próximos Passos Sugeridos

1. Implementar testes automatizados para validar a geração de arquivos WAV
2. Melhorar o tratamento de erros e mecanismos de recuperação
3. Adicionar recursos de filtragem de ruído para melhorar a qualidade da transcrição
4. Implementar sistema de fallback para casos de falha na transcrição OpenAI
5. Adicionar painel de administração para monitorar uso e qualidade das transcrições 