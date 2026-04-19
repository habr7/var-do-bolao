import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('✅ Banco de dados conectado');
  } catch (error) {
    console.error('❌ Erro ao conectar banco de dados:', error);
    process.exit(1);
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  console.log('🔌 Banco de dados desconectado');
}
