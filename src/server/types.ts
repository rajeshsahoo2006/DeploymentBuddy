/**
 * Shared types for the Deployment Buddy MCP Server
 */

// Salesforce Org types
export interface OrgInfo {
  alias: string;
  username: string;
  instanceUrl?: string;
  orgId?: string;
  isDefault?: boolean;
  isScratch?: boolean;
}

// Metadata types
export interface Bot {
  name: string;
  fullName: string;
  label?: string;
  description?: string;
  filePath: string;
}

export interface BotVersion {
  name: string;
  fullName: string;
  botName: string;
  versionNumber?: string;
  filePath: string;
}

export interface GenAiAsset {
  name: string;
  fullName: string;
  type: GenAiAssetType;
  description?: string;
  filePath: string;
}

export type GenAiAssetType = 'GenAiFunction' | 'GenAiPlugin' | 'GenAiPlannerBundle';

// Reference types for dependency tracking
export interface Reference {
  sourceType: MetadataType;
  sourceName: string;
  targetType: MetadataType;
  targetName: string;
  referenceType: 'direct' | 'inferred';
}

export type MetadataType = 
  | 'ApexClass'
  | 'Flow'
  | 'GenAiFunction'
  | 'GenAiPlugin'
  | 'GenAiPlannerBundle'
  | 'Bot'
  | 'BotVersion';

// Deployment types
export interface DeployBatch {
  batchNumber: number;
  metadataType: MetadataType;
  items: DeployItem[];
}

export interface DeployItem {
  type: MetadataType;
  name: string;
  fullName: string;
  filePath: string;
}

export interface DeployPlan {
  batches: DeployBatch[];
  totalItems: number;
  estimatedSteps: number;
  warnings: string[];
}

export interface DeployResult {
  success: boolean;
  batchNumber?: number;
  deployedItems: string[];
  errors: DeployError[];
  logs: string[];
  duration: number;
}

export interface DeployError {
  componentType: string;
  componentName: string;
  message: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface DeployPlanResult {
  success: boolean;
  completedBatches: number;
  totalBatches: number;
  results: DeployResult[];
  failedAtBatch?: number;
  overallDuration: number;
}

// Package.xml types
export interface PackageManifest {
  types: PackageType[];
  version: string;
}

export interface PackageType {
  members: string[];
  name: string;
}

// Layer order for deployment (enforced constraint)
export const DEPLOYMENT_LAYER_ORDER: MetadataType[] = [
  'ApexClass',
  'Flow',
  'GenAiFunction',
  'GenAiPlugin',
  'GenAiPlannerBundle',
  'Bot',
  'BotVersion'
];

// API version for Salesforce
export const SF_API_VERSION = '59.0';
