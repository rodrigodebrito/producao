const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Obter o diretório de uploads
const uploadDir = path.join(__dirname, '../../uploads/audio');

// DESABILITADO: Criação de diretório (apenas para o deploy)
// if (!fs.existsSync(uploadDir)) {
//   try {
//     fs.mkdirSync(uploadDir, { recursive: true });
//     console.log('Diretório de upload de áudio criado:', uploadDir);
//   } catch (err) {
//     console.error('Erro ao criar diretório de upload:', err);
//   }
// }

console.log('Diretório de upload:', uploadDir, '(criação desabilitada)');

// Configuração do storage para arquivos de áudio (mantendo armazenamento em disco)
const audioStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Criar um nome único com timestamp e ID aleatório
    const timestamp = Date.now();
    const randomId = Math.floor(Math.random() * 1000000);
    
    // Extrair a extensão correta do arquivo baseado no mimetype
    let extension = '.webm'; // Padrão
    if (file.mimetype.includes('mp3')) extension = '.mp3';
    else if (file.mimetype.includes('wav')) extension = '.wav';
    else if (file.mimetype.includes('ogg')) extension = '.ogg';
    else if (file.mimetype.includes('mp4')) extension = '.mp4';
    
    // Nome do arquivo
    const filename = `audio-${timestamp}-${randomId}${extension}`;
    
    console.log('Salvando arquivo de áudio:', filename);
    console.log('Tipo MIME:', file.mimetype);
    
    cb(null, filename);
  }
});

// Filtro para verificar se o arquivo é de áudio
const audioFilter = (req, file, cb) => {
  // Tipos MIME de áudio suportados
  const allowedMimeTypes = [
    'audio/webm', 'audio/mp3', 'audio/mpeg', 
    'audio/mp4', 'audio/wav', 'audio/ogg',
    'audio/x-wav', 'audio/vnd.wave'
  ];
  
  if (allowedMimeTypes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
    cb(null, true);
  } else {
    console.warn('Tipo de arquivo rejeitado:', file.mimetype);
    cb(new Error(`Tipo de arquivo não suportado: ${file.mimetype}. Apenas arquivos de áudio são permitidos.`), false);
  }
};

// Configuração do multer para upload de áudio
const audioUpload = multer({
  storage: audioStorage,
  fileFilter: audioFilter,
  limits: {
    fileSize: 25 * 1024 * 1024, // Limite de 25MB
  }
});

module.exports = audioUpload; 