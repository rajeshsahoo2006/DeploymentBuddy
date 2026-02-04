#!/usr/bin/env node
/**
 * Deployment Buddy MCP Server
 * Exposes Salesforce GenAI deployment tools via Model Context Protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { SalesforceCli, getDefaultPackageXmlComponents } from './services/salesforce-cli';
import { MetadataParser } from './services/metadata-parser';
import { DependencyGraph } from './services/dependency-graph';
import {
  DeployPlan,
  DeployResult,
  DeployPlanResult,
  SF_API_VERSION
} from './types';

// Get project path from environment or use current directory
const SF_PROJECT_PATH = process.env.SF_PROJECT_PATH || process.cwd();
const DEFAULT_ORG = process.env.SF_DEFAULT_ORG;

// Initialize services
const salesforceCli = new SalesforceCli(SF_PROJECT_PATH, DEFAULT_ORG);
const metadataParser = new MetadataParser(SF_PROJECT_PATH);
const dependencyGraph = new DependencyGraph(metadataParser);

// Define all MCP tools
const TOOLS: Tool[] = [
  {
    name: 'get_org_alias',
    description: 'Get the current Salesforce org alias and username. Returns the connected org info.',
    inputSchema: {
      type: 'object',
      properties: {
        targetOrg: {
          type: 'string',
          description: 'Optional: specific org alias to query'
        }
      }
    }
  },
  {
    name: 'list_orgs',
    description: 'List all authenticated Salesforce orgs. Returns scratch orgs and non-scratch orgs (sandboxes, production).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'set_target_org',
    description: 'Set the target org for deployments. All subsequent deployments will use this org.',
    inputSchema: {
      type: 'object',
      properties: {
        targetOrg: {
          type: 'string',
          description: 'Org alias or username to use for deployments'
        }
      },
      required: ['targetOrg']
    }
  },
  {
    name: 'list_apex_classes',
    description: 'List all Apex classes in the project. Returns class names and file paths.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_flows',
    description: 'List all Flows in the project. Returns flow names, types, and file paths.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'ensure_package_xml',
    description: 'Write a package.xml manifest file for retrieving GenAI Bot metadata. Creates the file at the specified path with all necessary metadata types.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path where package.xml should be written (defaults to manifest/package.xml)'
        },
        includeAllApex: {
          type: 'boolean',
          description: 'Include all Apex classes (default: true)'
        },
        includeAllFlows: {
          type: 'boolean',
          description: 'Include all Flows (default: true)'
        }
      }
    }
  },
  {
    name: 'retrieve_metadata',
    description: 'Retrieve Salesforce metadata using a manifest file. Runs sf project retrieve start command.',
    inputSchema: {
      type: 'object',
      properties: {
        manifestPath: {
          type: 'string',
          description: 'Path to the package.xml manifest file'
        }
      },
      required: ['manifestPath']
    }
  },
  {
    name: 'list_bots',
    description: 'List all Einstein Bot metadata in the project. Returns bot names, labels, and file paths.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_bot_versions',
    description: 'List all versions for a specific Einstein Bot.',
    inputSchema: {
      type: 'object',
      properties: {
        botName: {
          type: 'string',
          description: 'Name of the bot to list versions for'
        }
      },
      required: ['botName']
    }
  },
  {
    name: 'list_genai_assets',
    description: 'List GenAI assets: Functions, Plugins, and Planners. Can filter by type.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['GenAiFunction', 'GenAiPlugin', 'GenAiPlannerBundle'],
          description: 'Filter by asset type (optional, returns all if not specified)'
        }
      }
    }
  },
  {
    name: 'analyze_references',
    description: 'Analyze a metadata component to find its Apex class and Flow dependencies. Returns all referenced components.',
    inputSchema: {
      type: 'object',
      properties: {
        assetType: {
          type: 'string',
          enum: ['ApexClass', 'Flow', 'GenAiFunction', 'GenAiPlugin', 'GenAiPlannerBundle', 'Bot', 'BotVersion'],
          description: 'Type of the metadata component'
        },
        assetName: {
          type: 'string',
          description: 'Name of the metadata component'
        }
      },
      required: ['assetType', 'assetName']
    }
  },
  {
    name: 'analyze_all_dependencies',
    description: 'Deep analyze all dependencies for a Bot or GenAI asset. Recursively scans XML files to find ALL dependent Apex classes, Flows, GenAI Functions, Plugins, and Planners. Use this to auto-select all required components for deployment.',
    inputSchema: {
      type: 'object',
      properties: {
        assetType: {
          type: 'string',
          enum: ['Bot', 'BotVersion', 'GenAiFunction', 'GenAiPlugin', 'GenAiPlannerBundle'],
          description: 'Type of the metadata component to analyze'
        },
        assetName: {
          type: 'string',
          description: 'Name of the metadata component'
        }
      },
      required: ['assetType', 'assetName']
    }
  },
  {
    name: 'build_deploy_plan',
    description: 'Build an ordered deployment plan for selected metadata. Resolves dependencies and creates batches following the required deployment order: ApexClass -> Flow -> GenAiFunction -> GenAiPlugin -> GenAiPlanner -> Bot -> BotVersion.',
    inputSchema: {
      type: 'object',
      properties: {
        selection: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of items to deploy, format: "Type:Name" (e.g., "Bot:Einstein_Bot_1") or just "Name"'
        }
      },
      required: ['selection']
    }
  },
  {
    name: 'deploy_batch',
    description: 'Deploy a single batch of metadata components. Used for executing individual batches from a deployment plan.',
    inputSchema: {
      type: 'object',
      properties: {
        components: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              name: { type: 'string' }
            },
            required: ['type', 'name']
          },
          description: 'Array of components to deploy'
        },
        checkOnly: {
          type: 'boolean',
          description: 'If true, validate only without deploying (default: false)'
        }
      },
      required: ['components']
    }
  },
  {
    name: 'deploy_plan',
    description: 'Execute a full deployment plan. Deploys batches sequentially, stops on first failure. Returns detailed logs for each batch.',
    inputSchema: {
      type: 'object',
      properties: {
        plan: {
          type: 'object',
          description: 'Deployment plan object from build_deploy_plan'
        },
        checkOnly: {
          type: 'boolean',
          description: 'If true, validate only without deploying (default: false)'
        }
      },
      required: ['plan']
    }
  },
  {
    name: 'validate_plan',
    description: 'Validate a deployment plan batch by batch. Creates cumulative package.xml for each batch and runs sf project deploy validate. Identifies missing metadata and suggests fixes.',
    inputSchema: {
      type: 'object',
      properties: {
        plan: {
          type: 'object',
          description: 'Deployment plan object from build_deploy_plan'
        }
      },
      required: ['plan']
    }
  }
];

// Create MCP server
const server = new Server(
  {
    name: 'deployment-buddy',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_org_alias': {
        const targetOrg = (args as any)?.targetOrg;
        const result = await salesforceCli.getOrgInfo(targetOrg);
        
        if (result.success && result.data) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  alias: result.data.alias,
                  username: result.data.username,
                  instanceUrl: result.data.instanceUrl,
                  orgId: result.data.orgId
                }, null, 2)
              }
            ]
          };
        }
        
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true
        };
      }

      case 'list_orgs': {
        const result = await salesforceCli.listOrgs();
        
        if (result.success && result.data) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                count: result.data.length,
                orgs: result.data
              }, null, 2)
            }]
          };
        }
        
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true
        };
      }

      case 'set_target_org': {
        const targetOrg = (args as any)?.targetOrg;
        if (!targetOrg) {
          return {
            content: [{ type: 'text', text: 'Error: targetOrg is required' }],
            isError: true
          };
        }
        
        salesforceCli.setDefaultOrg(targetOrg);
        
        // Verify the org exists and is accessible
        const orgResult = await salesforceCli.getOrgInfo(targetOrg);
        
        if (orgResult.success && orgResult.data) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Target org set to: ${targetOrg}`,
                org: orgResult.data
              }, null, 2)
            }]
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Target org set to: ${targetOrg}`,
              warning: 'Could not verify org access'
            }, null, 2)
          }]
        };
      }

      case 'list_apex_classes': {
        const classes = await metadataParser.listApexClasses();
        const classDetails = await metadataParser.getApexClassDetails();
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: classDetails.length,
              classes: classDetails
            }, null, 2)
          }]
        };
      }

      case 'list_flows': {
        const flows = await metadataParser.getFlowDetails();
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: flows.length,
              flows: flows
            }, null, 2)
          }]
        };
      }

      case 'ensure_package_xml': {
        const path = (args as any)?.path || `${SF_PROJECT_PATH}/manifest/package.xml`;
        const includeAllApex = (args as any)?.includeAllApex !== false;
        const includeAllFlows = (args as any)?.includeAllFlows !== false;
        
        let components = getDefaultPackageXmlComponents();
        
        if (!includeAllApex) {
          components = components.filter(c => c.type !== 'ApexClass');
        }
        if (!includeAllFlows) {
          components = components.filter(c => c.type !== 'Flow');
        }
        
        const result = await salesforceCli.writePackageXml(path, components);
        
        if (result.success) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                path: result.data,
                message: `package.xml written successfully with ${components.length} metadata types`
              }, null, 2)
            }]
          };
        }
        
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true
        };
      }

      case 'retrieve_metadata': {
        const manifestPath = (args as any)?.manifestPath;
        if (!manifestPath) {
          return {
            content: [{ type: 'text', text: 'Error: manifestPath is required' }],
            isError: true
          };
        }
        
        const result = await salesforceCli.retrieveMetadata(manifestPath);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: result.success,
              message: result.success ? 'Metadata retrieved successfully' : result.error,
              output: result.rawOutput
            }, null, 2)
          }],
          isError: !result.success
        };
      }

      case 'list_bots': {
        const bots = await metadataParser.listBots();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: bots.length,
              bots: bots
            }, null, 2)
          }]
        };
      }

      case 'list_bot_versions': {
        const botName = (args as any)?.botName;
        if (!botName) {
          return {
            content: [{ type: 'text', text: 'Error: botName is required' }],
            isError: true
          };
        }
        
        const versions = await metadataParser.listBotVersions(botName);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              botName: botName,
              count: versions.length,
              versions: versions
            }, null, 2)
          }]
        };
      }

      case 'list_genai_assets': {
        const type = (args as any)?.type;
        const assets = await metadataParser.listGenAiAssets(type);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              filter: type || 'all',
              count: assets.length,
              assets: assets
            }, null, 2)
          }]
        };
      }

      case 'analyze_references': {
        const assetType = (args as any)?.assetType;
        const assetName = (args as any)?.assetName;
        
        if (!assetType || !assetName) {
          return {
            content: [{ type: 'text', text: 'Error: assetType and assetName are required' }],
            isError: true
          };
        }
        
        const references = await metadataParser.analyzeReferences(assetType, assetName);
        
        // Group references by target type
        const grouped: Record<string, string[]> = {};
        for (const ref of references) {
          if (!grouped[ref.targetType]) {
            grouped[ref.targetType] = [];
          }
          if (!grouped[ref.targetType].includes(ref.targetName)) {
            grouped[ref.targetType].push(ref.targetName);
          }
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              source: { type: assetType, name: assetName },
              referenceCount: references.length,
              referencesByType: grouped,
              details: references
            }, null, 2)
          }]
        };
      }

      case 'analyze_all_dependencies': {
        const assetType = (args as any)?.assetType;
        const assetName = (args as any)?.assetName;
        
        if (!assetType || !assetName) {
          return {
            content: [{ type: 'text', text: 'Error: assetType and assetName are required' }],
            isError: true
          };
        }
        
        const result = await metadataParser.analyzeAllDependencies(assetType, assetName);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              source: { type: assetType, name: assetName },
              summary: result.summary,
              apexClasses: result.apexClasses,
              flows: result.flows,
              genAiFunctions: result.genAiFunctions,
              genAiPlugins: result.genAiPlugins,
              genAiPlannerBundles: result.genAiPlannerBundles,
              allDependencies: result.dependencies
            }, null, 2)
          }]
        };
      }

      case 'build_deploy_plan': {
        const selection = (args as any)?.selection;
        if (!selection || !Array.isArray(selection)) {
          return {
            content: [{ type: 'text', text: 'Error: selection array is required' }],
            isError: true
          };
        }
        
        const plan = await dependencyGraph.buildDeployPlan(selection);
        const validation = dependencyGraph.validatePlan(plan);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              plan: plan,
              validation: validation,
              summary: {
                totalBatches: plan.batches.length,
                totalItems: plan.totalItems,
                batchOrder: plan.batches.map(b => `${b.batchNumber}. ${b.metadataType} (${b.items.length} items)`)
              }
            }, null, 2)
          }]
        };
      }

      case 'deploy_batch': {
        const components = (args as any)?.components;
        const checkOnly = (args as any)?.checkOnly || false;
        
        if (!components || !Array.isArray(components)) {
          return {
            content: [{ type: 'text', text: 'Error: components array is required' }],
            isError: true
          };
        }
        
        const startTime = Date.now();
        const result = await salesforceCli.deployComponents(components, checkOnly);
        const duration = Date.now() - startTime;
        
        const deployResult: DeployResult = {
          success: result.success,
          deployedItems: components.map(c => `${c.type}:${c.name}`),
          errors: [],
          logs: [result.rawOutput || ''],
          duration
        };
        
        if (!result.success && result.data?.details?.componentFailures) {
          const failures = Array.isArray(result.data.details.componentFailures)
            ? result.data.details.componentFailures
            : [result.data.details.componentFailures];
          
          deployResult.errors = failures.map((f: any) => ({
            componentType: f.componentType,
            componentName: f.fullName,
            message: f.problem,
            lineNumber: f.lineNumber,
            columnNumber: f.columnNumber
          }));
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(deployResult, null, 2)
          }],
          isError: !result.success
        };
      }

      case 'deploy_plan': {
        const plan = (args as any)?.plan as DeployPlan;
        const checkOnly = (args as any)?.checkOnly || false;
        
        if (!plan || !plan.batches) {
          return {
            content: [{ type: 'text', text: 'Error: valid plan object is required' }],
            isError: true
          };
        }
        
        const overallStart = Date.now();
        const results: DeployResult[] = [];
        let failedAtBatch: number | undefined;
        
        for (const batch of plan.batches) {
          const batchStart = Date.now();
          const components = batch.items.map(item => ({
            type: item.type,
            name: item.name
          }));
          
          const result = await salesforceCli.deployComponents(components, checkOnly);
          const batchDuration = Date.now() - batchStart;
          
          const batchResult: DeployResult = {
            success: result.success,
            batchNumber: batch.batchNumber,
            deployedItems: components.map(c => `${c.type}:${c.name}`),
            errors: [],
            logs: [
              `Batch ${batch.batchNumber}: ${batch.metadataType}`,
              `Items: ${components.length}`,
              result.rawOutput || ''
            ],
            duration: batchDuration
          };
          
          if (!result.success) {
            if (result.data?.details?.componentFailures) {
              const failures = Array.isArray(result.data.details.componentFailures)
                ? result.data.details.componentFailures
                : [result.data.details.componentFailures];
              
              batchResult.errors = failures.map((f: any) => ({
                componentType: f.componentType,
                componentName: f.fullName,
                message: f.problem,
                lineNumber: f.lineNumber,
                columnNumber: f.columnNumber
              }));
            }
            
            failedAtBatch = batch.batchNumber;
            results.push(batchResult);
            break; // Stop on first failure
          }
          
          results.push(batchResult);
        }
        
        const planResult: DeployPlanResult = {
          success: failedAtBatch === undefined,
          completedBatches: results.filter(r => r.success).length,
          totalBatches: plan.batches.length,
          results,
          failedAtBatch,
          overallDuration: Date.now() - overallStart
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(planResult, null, 2)
          }],
          isError: !planResult.success
        };
      }

      case 'validate_plan': {
        const plan = (args as any)?.plan as DeployPlan;
        
        if (!plan || !plan.batches) {
          return {
            content: [{ type: 'text', text: 'Error: valid plan object is required' }],
            isError: true
          };
        }
        
        const overallStart = Date.now();
        const batchResults: Array<{
          batchNumber: number;
          metadataType: string;
          success: boolean;
          errors: string[];
          missingMetadata: Array<{ type: string; name: string }>;
          componentsValidated: number;
        }> = [];
        
        // Validate batch by batch with cumulative components
        const cumulativeComponents: Array<{ type: string; name: string }> = [];
        let failedAtBatch: number | undefined;
        const allMissingMetadata: Array<{ type: string; name: string }> = [];
        
        for (const batch of plan.batches) {
          // Add this batch's components to cumulative list
          const batchComponents = batch.items.map(item => ({
            type: item.type,
            name: item.name
          }));
          cumulativeComponents.push(...batchComponents);
          
          // Validate cumulative components up to this batch
          const result = await salesforceCli.validateComponents(cumulativeComponents);
          
          const batchResult = {
            batchNumber: batch.batchNumber,
            metadataType: batch.metadataType,
            success: result.success,
            errors: result.errorDetails || [],
            missingMetadata: result.missingMetadata || [],
            componentsValidated: cumulativeComponents.length
          };
          
          if (!result.success) {
            // Collect missing metadata for potential auto-fix
            if (result.missingMetadata && result.missingMetadata.length > 0) {
              for (const missing of result.missingMetadata) {
                // Check if this metadata exists locally
                const existsLocally = await checkMetadataExistsLocally(missing.type, missing.name);
                if (existsLocally) {
                  allMissingMetadata.push(missing);
                }
              }
            }
            
            failedAtBatch = batch.batchNumber;
            batchResults.push(batchResult);
            break; // Stop on first failure
          }
          
          batchResults.push(batchResult);
        }
        
        // Helper function to check if metadata exists locally
        async function checkMetadataExistsLocally(type: string, name: string): Promise<boolean> {
          try {
            if (type === 'ApexClass') {
              const classes = await metadataParser.listApexClasses();
              return classes.includes(name);
            } else if (type === 'Flow') {
              const flows = await metadataParser.listFlows();
              return flows.includes(name);
            } else if (type === 'GenAiFunction' || type === 'GenAiPlugin' || type === 'GenAiPlannerBundle') {
              const assets = await metadataParser.listGenAiAssets(type as any);
              return assets.some(a => a.name === name);
            }
            return false;
          } catch {
            return false;
          }
        }
        
        const validationResult = {
          success: failedAtBatch === undefined,
          completedBatches: batchResults.filter(r => r.success).length,
          totalBatches: plan.batches.length,
          results: batchResults,
          failedAtBatch,
          missingMetadataFoundLocally: allMissingMetadata,
          overallDuration: Date.now() - overallStart,
          suggestion: allMissingMetadata.length > 0 
            ? `Found ${allMissingMetadata.length} missing dependencies that exist locally. Consider adding them to the plan: ${allMissingMetadata.map(m => `${m.type}:${m.name}`).join(', ')}`
            : undefined
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(validationResult, null, 2)
          }],
          isError: !validationResult.success
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true
        };
    }
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error executing ${name}: ${error.message}`
      }],
      isError: true
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Deployment Buddy MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
