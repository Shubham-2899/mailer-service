import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mailRoutes from './routes/mail.routes';
import { connectDatabase } from './config/database.config';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/mail', mailRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'MMS Mailer Service',
    version: '1.0.0',
    status: 'running',
    mailerId: process.env.MAILER_ID || 'unknown',
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
async function startServer() {
  try {
    // Connect to MongoDB
    await connectDatabase();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`🚀 Mailer service running on port ${PORT}`);
      console.log(`📧 Mailer ID: ${process.env.MAILER_ID || 'unknown'}`);
      console.log(`✅ Ready to process campaigns`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

startServer();
