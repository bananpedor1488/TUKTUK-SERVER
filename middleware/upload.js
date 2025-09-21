const multer = require('multer');

// Настройка хранилища в памяти (для base64)
const storage = multer.memoryStorage();

// Фильтр файлов
const fileFilter = (req, file, cb) => {
  // Разрешенные типы файлов
  const allowedTypes = [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/ogg',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Неподдерживаемый тип файла'), false);
  }
};

// Настройка multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 32 * 1024 * 1024, // 32MB максимум для ImgBB
    files: 5 // Максимум 5 файлов
  }
});

// Middleware для загрузки файлов
const uploadFiles = upload.array('files', 5);

// Middleware для загрузки одного файла
const uploadSingle = upload.single('image');

// Обработчик ошибок загрузки
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        message: 'Файл слишком большой. Максимальный размер: 32MB' 
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ 
        message: 'Слишком много файлов. Максимум: 5 файлов' 
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ 
        message: 'Неожиданное поле файла' 
      });
    }
  }
  
  if (err.message === 'Неподдерживаемый тип файла') {
    return res.status(400).json({ 
      message: 'Неподдерживаемый тип файла' 
    });
  }
  
  next(err);
};

module.exports = {
  uploadFiles,
  uploadSingle,
  handleUploadError
};
