import { Horizon, Networks } from '@stellar/stellar-sdk';
import { logger } from '../lib/logger';

const NETWORK = process.env.STELLAR_NETWORK || 'testnet';
const HORIZON_URL =
  NETWORK === 'mainnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

const SOROBAN_RPC_URL =
  NETWORK === 'mainnet'
    ? 'https://mainnet.sorobanrpc.com'
    : 'https://soroban-testnet.stellar.org';

const NETWORK_PASSPHRASE =
  NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

export const stellarConfig = {
  network: NETWORK,
  horizonUrl: HORIZON_URL,
  sorobanRpcUrl: SOROBAN_RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
};

export function getHorizonServer(): Horizon.Server {
  return new Horizon.Server(HORIZON_URL);
}

export const CONTRACT_IDS = {
  AD_REGISTRY: process.env.CONTRACT_AD_REGISTRY || '',
  CAMPAIGN_ORCHESTRATOR: process.env.CONTRACT_CAMPAIGN_ORCHESTRATOR || '',
  ESCROW_VAULT: process.env.CONTRACT_ESCROW_VAULT || '',
  FRAUD_PREVENTION: process.env.CONTRACT_FRAUD_PREVENTION || '',
  PAYMENT_PROCESSOR: process.env.CONTRACT_PAYMENT_PROCESSOR || '',
  GOVERNANCE_TOKEN: process.env.CONTRACT_GOVERNANCE_TOKEN || '',
  GOVERNANCE_DAO: process.env.CONTRACT_GOVERNANCE_DAO || '',
  PUBLISHER_VERIFICATION: process.env.CONTRACT_PUBLISHER_VERIFICATION || '',
  PUBLISHER_REPUTATION: process.env.CONTRACT_PUBLISHER_REPUTATION || '',
  ANALYTICS_AGGREGATOR: process.env.CONTRACT_ANALYTICS_AGGREGATOR || '',
  AUCTION_ENGINE: process.env.CONTRACT_AUCTION_ENGINE || '',
  SUBSCRIPTION_MANAGER: process.env.CONTRACT_SUBSCRIPTION_MANAGER || '',
  PRIVACY_LAYER: process.env.CONTRACT_PRIVACY_LAYER || '',
  TARGETING_ENGINE: process.env.CONTRACT_TARGETING_ENGINE || '',
  DISPUTE_RESOLUTION: process.env.CONTRACT_DISPUTE_RESOLUTION || '',
  REVENUE_SETTLEMENT: process.env.CONTRACT_REVENUE_SETTLEMENT || '',
  REWARDS_DISTRIBUTOR: process.env.CONTRACT_REWARDS_DISTRIBUTOR || '',
  CAMPAIGN_LIFECYCLE: process.env.CONTRACT_CAMPAIGN_LIFECYCLE || '',
  CAMPAIGN_SCHEDULER: process.env.CONTRACT_CAMPAIGN_SCHEDULER || '',
  PAYOUT_AUTOMATION: process.env.CONTRACT_PAYOUT_AUTOMATION || '',
  FEE_MANAGER: process.env.CONTRACT_FEE_MANAGER || '',
  AD_SLOT_MARKET: process.env.CONTRACT_AD_SLOT_MARKET || '',
  TOKEN_VESTING: process.env.CONTRACT_TOKEN_VESTING || '',
  REFERRAL_SYSTEM: process.env.CONTRACT_REFERRAL_SYSTEM || '',
  CROSS_CHAIN_BRIDGE: process.env.CONTRACT_CROSS_CHAIN_BRIDGE || '',
  EMERGENCY_STOP: process.env.CONTRACT_EMERGENCY_STOP || '',
  DATA_MARKETPLACE: process.env.CONTRACT_DATA_MARKETPLACE || '',
  COMPLIANCE_KYC: process.env.CONTRACT_COMPLIANCE_KYC || '',
  CREATIVE_NFT: process.env.CONTRACT_CREATIVE_NFT || '',
  ATTRIBUTION_TRACKER: process.env.CONTRACT_ATTRIBUTION_TRACKER || '',
  REWARD_POOL: process.env.CONTRACT_REWARD_POOL || '',
  MICRO_PAYMENT: process.env.CONTRACT_MICRO_PAYMENT || '',
  CONTENT_MODERATION: process.env.CONTRACT_CONTENT_MODERATION || '',
  MULTI_SIG_TREASURY: process.env.CONTRACT_MULTI_SIG_TREASURY || '',
  DYNAMIC_PRICING: process.env.CONTRACT_DYNAMIC_PRICING || '',
  GEO_TARGETING: process.env.CONTRACT_GEO_TARGETING || '',
  LOYALTY_PROGRAM: process.env.CONTRACT_LOYALTY_PROGRAM || '',
  API_GATEWAY: process.env.CONTRACT_API_GATEWAY || '',
  AB_TESTING: process.env.CONTRACT_AB_TESTING || '',
  BUDGET_OPTIMIZER: process.env.CONTRACT_BUDGET_OPTIMIZER || '',
  NOTIFICATION_HUB: process.env.CONTRACT_NOTIFICATION_HUB || '',
  AD_VERIFICATION: process.env.CONTRACT_AD_VERIFICATION || '',
  PUBLISHER_NETWORK: process.env.CONTRACT_PUBLISHER_NETWORK || '',
};

/**
 * Core contracts required for the platform to function.
 * All others are optional/feature-flagged.
 */
const REQUIRED_CONTRACT_ENV_VARS = [
  'CONTRACT_AD_REGISTRY',
  'CONTRACT_CAMPAIGN_ORCHESTRATOR',
  'CONTRACT_ESCROW_VAULT',
  'CONTRACT_FRAUD_PREVENTION',
  'CONTRACT_PAYMENT_PROCESSOR',
  'CONTRACT_AUCTION_ENGINE',
  'CONTRACT_REVENUE_SETTLEMENT',
  'CONTRACT_PUBLISHER_VERIFICATION',
  'CONTRACT_ANALYTICS_AGGREGATOR',
];

/**
 * Validates that all required contract IDs are present.
 * - In production: throws on any missing value, preventing startup.
 * - In development: logs a warning for each missing value so the server
 *   still starts (useful when only testing non-contract routes).
 * Pass SKIP_CONTRACT_VALIDATION=true to suppress even the warnings.
 */
export function validateContractIds(): void {
  if (process.env.SKIP_CONTRACT_VALIDATION === 'true') {
    logger.warn('[Config] Contract ID validation skipped (SKIP_CONTRACT_VALIDATION=true)');
    return;
  }

  const missing = REQUIRED_CONTRACT_ENV_VARS.filter(
    (key) => !process.env[key] || process.env[key] === 'PLACEHOLDER',
  );

  if (missing.length === 0) return;

  const message = `Missing or placeholder contract IDs:\n  ${missing.join('\n  ')}`;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`[Config] ${message}\nSet these environment variables before starting the server.`);
  }

  logger.warn(`[Config] ${message}`);
  logger.warn('[Config] Contract calls will fail for the above contracts. Set SKIP_CONTRACT_VALIDATION=true to suppress this warning.');
}
