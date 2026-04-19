import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function isValidPassword(plain: string): boolean {
  return typeof plain === 'string' && plain.length >= 6 && plain.length <= 100;
}
