const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Definir diretórios de upload
const uploadDir = path.join(__dirname, '../../uploads');
const profileUploadDir = path.join(uploadDir, 'profiles');

// DESABILITADO: Criação de diretórios (apenas para o deploy)
// try {
//   if (!fs.existsSync(uploadDir)) {
//     console.log('Criando diretório de uploads:', uploadDir);
//     fs.mkdirSync(uploadDir, { recursive: true });
//   }
//   if (!fs.existsSync(profileUploadDir)) {
//     console.log('Criando diretório de perfis:', profileUploadDir);
//     fs.mkdirSync(profileUploadDir, { recursive: true });
//   }
// } catch (error) {
//   console.error('Erro ao criar diretórios de upload:', error);
// }

console.log('Diretórios de upload:', uploadDir, profileUploadDir, '(criação desabilitada)');

// Configuração de armazenamento
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, profileUploadDir);
  },
  
  filename: function (req, file, cb) {
    // Gerar um nome único para o arquivo
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    const filename = 'profile-' + uniqueSuffix + extension;
    console.log('Salvando arquivo:', filename);
    cb(null, filename);
  }
});

// Filtro para aceitar apenas imagens
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif'];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    console.log('Arquivo aceito:', file.originalname, file.mimetype);
    cb(null, true);
  } else {
    console.log('Arquivo rejeitado:', file.originalname, file.mimetype);
    cb(new Error('Formato de arquivo não suportado. Envie apenas imagens (JPEG, PNG, JPG, GIF).'), false);
  }
};

// Configuração do multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

module.exports = upload; 