import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import os from 'os';
import apiRoutes from './routes/api.routes';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3010;

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 파일 제공
app.use(express.static('public'));

// API 라우트
app.use('/api', apiRoutes);

// 루트 경로
app.get('/', (req: Request, res: Response) => {
  res.send('LOL Team Maker API is running');
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📝 API endpoint: http://localhost:${PORT}/api`);
  
  if (!process.env.RIOT_API_KEY) {
    console.warn('⚠️  RIOT_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.');
  }
});

export default app;

