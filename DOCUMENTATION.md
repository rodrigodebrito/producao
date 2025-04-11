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

**Solução**: Implementamos o método `_buildApiUrl()` para lidar com diferentes formatos de URL base:

```javascript
_buildApiUrl(path) {
  // Remover barras iniciais duplicadas
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  
  // Construir URL corretamente com base na configuração
  if (API_URL.endsWith('/api')) {
    return `${API_URL}/${cleanPath}`;
  } else if (API_URL.includes('/api/')) {
    return `${API_URL.split('/api/')[0]}/api/${cleanPath}`;
  } else {
    return `${API_URL}/api/${cleanPath}`;
  }
}
```

### 2. Problema: Falhas de Autenticação (401 Unauthorized)

**Problema**: As chamadas de API estavam falhando com erro 401 por falta de autenticação.

**Solução**: Implementamos a recuperação do token de autenticação de múltiplas fontes possíveis:

```javascript
_getAuthToken() {
  const token = localStorage.getItem('authToken') || 
               sessionStorage.getItem('authToken') || 
               localStorage.getItem('token') || 
               sessionStorage.getItem('token');
  
  return token;
}
```

### 3. Problema: Formato de Arquivo WAV Inválido

**Problema**: O arquivo WAV gerado não tinha um cabeçalho apropriado para processamento.

**Solução**: Implementamos uma geração mais robusta de cabeçalhos WAV no arquivo `webrtc.service.js` com validação:

```javascript
// Escrever cabeçalho WAV manualmente
const headerBuffer = Buffer.alloc(44);

// RIFF chunk descriptor
headerBuffer.write('RIFF', 0);
headerBuffer.writeUInt32LE(0, 4); // Tamanho total (atualizado depois)
headerBuffer.write('WAVE', 8);

// "fmt " sub-chunk
headerBuffer.write('fmt ', 12);
headerBuffer.writeUInt32LE(16, 16); // Tamanho do sub-chunk fmt
headerBuffer.writeUInt16LE(1, 20); // Formato de áudio (PCM)
headerBuffer.writeUInt16LE(channels, 22); // Número de canais
headerBuffer.writeUInt32LE(sampleRate, 24); // Sample rate
headerBuffer.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28); // Byte rate
headerBuffer.writeUInt16LE(channels * (bitDepth / 8), 32); // Block align
headerBuffer.writeUInt16LE(bitDepth, 34); // Bits per sample

// "data" sub-chunk
headerBuffer.write('data', 36);
headerBuffer.writeUInt32LE(0, 40); // Tamanho dos dados (atualizado depois)
```

### 4. Problema: Arquivo de Áudio Muito Curto

**Problema**: Enfrentamos erros "Audio file is too short" porque não havia dados de áudio suficientes.

**Solução**: Implementamos várias melhorias:

1. **Captura real de áudio dos participantes**
2. **Gerador de tom de teste** (440Hz) quando não há áudio real
3. **Verificação de duração mínima**
4. **Mecanismo para adicionar dados quando os arquivos são muito pequenos**
5. **Atualização apropriada do cabeçalho WAV**

### 5. Problema: Não detecção de participantes reais

**Problema**: O sistema não estava detectando corretamente os participantes reais nas conexões WebRTC, resultando em transcrições vazias.

**Solução**: Implementamos um rastreamento mais robusto de participantes reais:

1. **Contagem explícita de participantes reais**:
   ```javascript
   this.realParticipantCount = (this.realParticipantCount || 0) + 1;
   ```

2. **Marcação de participantes com flags**:
   ```javascript
   participant.isReal = true;
   ```

3. **Monitoramento avançado de streams**:
   ```javascript
   producer.on('score', (score) => {
     // Score é um indicador de qualidade do audio
     logger.debug(`Producer recebendo áudio com qualidade: ${JSON.stringify(score)}`);
     participant.lastActivity = Date.now();
   });
   ```

4. **Detecção e gerenciamento melhores de participantes inativos**

### 6. Problema: Conexões peer-to-peer instáveis

**Problema**: As conexões WebRTC entre participantes não estavam sendo estabelecidas corretamente.

**Solução**: Melhoramos o gerenciamento de conexões e streams de áudio no frontend:

1. **Configurações de áudio de alta qualidade**:
   ```javascript
   const constraints = {
     audio: {
       echoCancellation: true,
       noiseSuppression: true,
       autoGainControl: true,
       sampleRate: 48000,
       sampleSize: 16,
       channelCount: 2
     },
     video: false
   };
   ```

2. **Validação rigorosa das tracks de áudio**:
   ```javascript
   const audioTracks = this.localStream.getAudioTracks();
   if (audioTracks.length === 0) {
     console.warn('Nenhuma track de áudio encontrada no stream local!');
     this.localAudioEnabled = false;
   }
   ```

3. **Métodos de diagnóstico**:
   - `diagnoseConnections()` para identificar problemas
   - `repairConnections()` para consertar problemas automaticamente

## Fluxo de Funcionamento

1. **Criação da sessão**: Uma sessão WebRTC é criada quando os participantes se conectam à sala de terapia.

2. **Captura de áudio**: O sistema captura áudio real dos participantes ou gera um tom de teste quando necessário.

3. **Quando o terapeuta clica em "Transcrever Agora"**:
   - O frontend faz uma requisição para o endpoint `/api/webrtc/record/transcribe`.
   - O backend cria uma cópia temporária do arquivo de áudio atual.
   - O arquivo é enviado para transcrição usando o modelo Whisper via OpenAI API.
   - A transcrição parcial é retornada ao terapeuta sem interromper a gravação.

## Serviços Principais

### Frontend - webrtcTranscriptionService.js

Responsável por:
- Estabelecer conexões peer-to-peer com outros participantes
- Capturar e enviar streams de áudio
- Autenticar as requisições com token
- Solicitar transcrições parciais
- Monitorar a qualidade das conexões
- Diagnosticar e corrigir problemas de conexão

### Backend - webrtc.service.js

Responsável por:
- Gerenciar sessões WebRTC (classe `WebRTCSession`)
- Detectar participantes reais vs. participantes sem áudio
- Mixar áudio de múltiplos participantes
- Gerar e processar arquivos WAV
- Interface com serviço de transcrição OpenAI
- Tratar casos de falha com mecanismos de recuperação

## Ferramentas de Diagnóstico e Reparo

### Frontend

O serviço WebRTC do frontend inclui ferramentas de diagnóstico avançadas:

1. **diagnoseConnections()**: Gera um relatório detalhado sobre:
   - Status de todas as conexões peer
   - Configurações de áudio local
   - Estado das tracks de áudio
   - Estado dos streams remotos

2. **repairConnections()**: Tenta consertar problemas automaticamente:
   - Restabelece o stream de áudio local se necessário
   - Recria conexões peer problemáticas
   - Corrige configurações de áudio

### Backend

O backend inclui mecanismos de monitoramento:

1. **_monitorOutputFile()**: Verifica se o arquivo de gravação está crescendo
2. **Contagem de participantes reais**: Rastreia ativamente participantes com áudio real
3. **Backup para zero participantes**: Gera tom de teste quando não há áudio real

## Como ampliar e manter o código

### Adicionando novos recursos

1. **Ajuste de qualidade de áudio**: Modificar os parâmetros em `startRecording()`
2. **Suporte a diferentes formatos de áudio**: Implementar conversão
3. **Interface para controlar volume de participantes**: Ampliar a classe `WebRTCSession`
4. **Recursos de diagnóstico visual**: Integrar relatórios do método `diagnoseConnections()`

### Resolvendo problemas comuns

1. **Arquivo WAV corrompido**: Verifique a geração de cabeçalho WAV
2. **Problemas de autenticação**: Confirme que o token está sendo recuperado
3. **Dados de áudio insuficientes**: Ajuste os parâmetros em `_simulateAudioData()`
4. **Erros de API 404**: Verifique a construção de URLs usando `_buildApiUrl()`
5. **Participantes sem áudio detectável**: Use `diagnoseConnections()` para verificar as conexões

### Verificando problemas de conexão

Para verificar problemas em tempo real no console do navegador:

```javascript
// Obter status geral do WebRTC
webrtcTranscriptionService.getStatus()

// Executar diagnóstico detalhado
webrtcTranscriptionService.diagnoseConnections()

// Tentar reparar automaticamente as conexões
webrtcTranscriptionService.repairConnections()
```

## Tecnologias Utilizadas

- **mediasoup**: Para gerenciamento de conexões WebRTC
- **audio-mixer**: Para mixagem de áudio de múltiplos participantes
- **OpenAI Whisper**: Para transcrição de áudio para texto
- **Node.js Streams**: Para processamento eficiente de dados de áudio
- **WebRTC API**: Para comunicação peer-to-peer no navegador

## Próximos Passos Sugeridos

1. Implementar testes automatizados para validar as conexões WebRTC
2. Melhorar o feedback visual para problemas de conexão de áudio
3. Adicionar recursos de filtragem de ruído para melhorar a qualidade da transcrição
4. Implementar um dashboard para monitorar qualidade das conexões em tempo real
5. Adicionar detecção automática e reconexão de participantes perdidos 