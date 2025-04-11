/**
 * Logger utilitário simples
 */
const logger = {
  info: (message, ...args) => {
    console.info(`[INFO] ${message}`, ...args);
  },
  
  warn: (message, ...args) => {
    console.warn(`[WARN] ${message}`, ...args);
  },
  
  error: (message, ...args) => {
    console.error(`[ERROR] ${message}`, ...args);
  },
  
  debug: (message, ...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }
};

/**
 * Cria um logger com o nome do módulo
 * @param {string} moduleName - Nome do módulo para ser incluído nos logs
 * @returns {Object} Logger configurado
 */
const createLogger = (moduleName) => {
  return {
    info: (message, ...args) => {
      console.info(`[INFO] [${moduleName}] ${message}`, ...args);
    },
    
    warn: (message, ...args) => {
      console.warn(`[WARN] [${moduleName}] ${message}`, ...args);
    },
    
    error: (message, ...args) => {
      console.error(`[ERROR] [${moduleName}] ${message}`, ...args);
    },
    
    debug: (message, ...args) => {
      if (process.env.NODE_ENV !== 'production') {
        console.debug(`[DEBUG] [${moduleName}] ${message}`, ...args);
      }
    }
  };
};

module.exports = { 
  logger, 
  createLogger 
}; 