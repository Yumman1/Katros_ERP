-- Counterparty role (buyer/seller) is per trade; master data uses a neutral default.
ALTER TYPE "CounterpartyType" ADD VALUE IF NOT EXISTS 'TRADING_PARTNER' BEFORE 'BUYER';
