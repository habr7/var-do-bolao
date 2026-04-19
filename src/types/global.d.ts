declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test';
    PORT: string;
    APP_URL: string;
    DATABASE_URL: string;
    REDIS_URL: string;
    EVOLUTION_API_URL: string;
    EVOLUTION_API_KEY: string;
    EVOLUTION_INSTANCE_NAME: string;
    FOOTBALL_API_KEY: string;
    FOOTBALL_API_URL: string;
    BOT_PREFIX: string;
    TIMEZONE: string;
    DEFAULT_CAMPEONATO: string;
  }
}
