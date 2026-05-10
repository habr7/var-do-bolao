#!/bin/bash
set -e

# Cria o banco "evolution" usado pela Evolution API.
# Roda apenas no primeiro start do container (entrypoint padrao do postgres).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE evolution;
    GRANT ALL PRIVILEGES ON DATABASE evolution TO $POSTGRES_USER;
EOSQL
