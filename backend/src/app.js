const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');

// Importar rotas
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.route');
const adminRoutes = require('./routes/admin.route');
const therapistRoutes = require('./routes/therapist.route');
const clientRoutes = require('./routes/client.route');
const subscriptionRoutes = require('./routes/subscription.route');
const sessionRoutes = require('./routes/session.route');
const meetingRoutes = require('./routes/meeting.routes');
const paymentRoutes = require('./routes/payment.route');
const aiRoutes = require('./routes/ai.routes');
const embedRoutes = require('./routes/embedding.route');
const chatRoutes = require('./routes/chat.route');
const insightRoutes = require('./routes/insight.routes');
const dailyProxyRoutes = require('./routes/daily-proxy.routes');

const app = express();

// Configuração de CORS
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'null', '*'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Test-Auth']
}));

// Configuração de CORS para testes
app.use(cors({
  origin: true, // Permitir qualquer origem
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with', 'X-Test-Auth']
}));

// Para garantir que OPTIONS preflight funcione corretamente
app.options('*', cors());

// Configuração de CORS otimizada
app.use(cors({
  origin: true, // Permitir qualquer origem
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with', 'X-Test-Auth', '*']
}));

// Para garantir que OPTIONS preflight funcione corretamente
app.options('*', cors());

// Middleware para JSON com limite aumentado
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware para debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Configurar pasta de uploads para ser acessível publicamente
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Middleware para arquivos estáticos
app.use(express.static(path.join(__dirname, '../public')));

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/therapists', therapistRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/meeting', meetingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/embed', embedRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/insights', insightRoutes);
app.use('/api/daily-proxy', dailyProxyRoutes);

// ... existing code ... 